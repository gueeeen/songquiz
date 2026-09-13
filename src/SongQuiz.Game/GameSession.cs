using SongQuiz.Common;
using SongQuiz.Quiz;

namespace SongQuiz.Game;

/// <summary>
/// 一場遊戲。題目、計時、判分、關卡推進都在這裡，前端只是顯示器。
/// </summary>
/// <remarks>
/// 為什麼判分要在伺服器：答案與剩餘秒數一旦交給瀏覽器，就等於交給玩家。
/// 前端拿到的 <see cref="QuestionView"/> 裡沒有正解，也沒有分數公式。
/// </remarks>
public sealed class GameSession
{
    private readonly QuestionMaker _maker;
    private readonly IClock _clock;
    private readonly Random _random;
    private readonly HashSet<long> _used = [];
    private readonly List<AnswerRecord> _records = [];

    /// <summary>這一關剩下幾題要「保證出現」的語種佇列。</summary>
    private readonly List<Language> _guaranteed = [];

    private Question? _current;

    private DateTimeOffset _issuedAt;

    public GameSession(string id, GameMode mode, SongBank bank, IClock clock, Random random)
    {
        Id = id;
        Mode = mode;
        _maker = new QuestionMaker(bank);
        _clock = clock;
        _random = random;
        Stage = mode == GameMode.Stage ? 1 : 0;
        PrepareRound();
    }

    public string Id { get; }
    public GameMode Mode { get; }
    public GameStatus Status { get; private set; } = GameStatus.BetweenQuestions;

    /// <summary>闖關模式的關卡編號；競速模式恆為 0。</summary>
    public int Stage { get; private set; }

    /// <summary>這一關（或這一場）已經答了幾題。</summary>
    public int Answered { get; private set; }

    /// <summary>這一關（或這一場）的分數。</summary>
    public int RoundScore { get; private set; }

    /// <summary>整場累積分數。闖關重來時歸零，因為門檻是按關算的。</summary>
    public int TotalScore { get; private set; }

    /// <summary>作答紀錄，結算頁用。</summary>
    public IReadOnlyList<AnswerRecord> Records => _records;

    /// <summary>現在這一題（含正解）。只開給測試，見 AssemblyInfo.cs。</summary>
    internal Question? CurrentQuestion => _current;

    /// <summary>這一關的規則；競速模式沒有關卡規則。</summary>
    public StageRule? CurrentStage =>
        Mode == GameMode.Stage ? Rules.Stages[Stage - 1] : null;

    private IReadOnlyList<Language> ActiveLanguages =>
        CurrentStage?.Languages ?? Rules.AllLanguages;

    /// <summary>
    /// 出下一題。整場已結束、或題庫湊不出題時回 null。
    /// </summary>
    public QuestionView? NextQuestion()
    {
        if (Status is GameStatus.Finished or GameStatus.StageFailed) return null;
        if (Answered >= Rules.QuestionsPerRound) return null;

        // 這一關新解鎖的語種要保證出現：剩餘題數不夠塞的時候就先塞它。
        Language? mustBe = null;
        if (_guaranteed.Count > 0 &&
            Rules.QuestionsPerRound - Answered <= _guaranteed.Count)
        {
            mustBe = _guaranteed[0];
        }

        var question = _maker.Next(ActiveLanguages, _used, _random, mustBe)
                       ?? _maker.Next(ActiveLanguages, _used, _random);
        if (question is null) return null;

        _current = question;
        _issuedAt = _clock.UtcNow;
        _used.Add(question.Answer.Id);
        _guaranteed.Remove(question.Answer.Language);
        Status = GameStatus.AwaitingAnswer;

        return ViewOf(question);
    }

    /// <summary>
    /// 作答。<paramref name="choiceId"/> 傳 null 代表時間到都沒選。
    /// </summary>
    public AnswerOutcome Answer(int? choiceId)
    {
        if (Status != GameStatus.AwaitingAnswer || _current is null)
            throw new InvalidOperationException("現在沒有等待作答的題目。");

        var elapsed = _clock.UtcNow - _issuedAt - Rules.LatencyGrace;
        if (elapsed < TimeSpan.Zero) elapsed = TimeSpan.Zero;

        var correct = choiceId is not null && choiceId == _current.AnswerId;
        var gained = Rules.ScoreFor(correct, elapsed);

        RoundScore += gained;
        TotalScore += gained;
        Answered++;
        _records.Add(new AnswerRecord(
            _current.Answer.Title,
            _current.Answer.Artist,
            _current.Answer.Language,
            correct,
            gained,
            elapsed));

        var answer = _current;
        _current = null;

        // 回報的是「剛剛打完的那一關」，所以在關卡推進之前先抄下來。
        var playedStage = Stage;
        var playedScore = RoundScore;
        var threshold = CurrentStage?.ScoreToClear ?? 0;

        Status = Answered >= Rules.QuestionsPerRound ? CloseRound() : GameStatus.BetweenQuestions;

        // 過關就當場推進，不要等到下次出題才算——否則在「過關」與「出下一題」
        // 之間，Stage 講的是上一關，任何讀這個欄位的人都會慢一拍。
        if (Status == GameStatus.StageCleared) AdvanceStage();

        return new AnswerOutcome(
            Correct: correct,
            CorrectChoiceId: answer.AnswerId,
            CorrectLabel: answer.Answer.Label,
            Gained: gained,
            RoundScore: playedScore,
            TotalScore: TotalScore,
            Status: Status,
            Stage: playedStage,
            ScoreToClear: threshold);
    }

    /// <summary>一關（或一場）打完了，看是過關、失敗還是整場結束。</summary>
    private GameStatus CloseRound()
    {
        if (Mode == GameMode.Speed) return GameStatus.Finished;

        var stage = Rules.Stages[Stage - 1];
        if (RoundScore < stage.ScoreToClear) return GameStatus.StageFailed;
        return Stage >= Rules.StageCount ? GameStatus.Finished : GameStatus.StageCleared;
    }

    /// <summary>過關之後往下一關；分數與題數重新起算，聽過的歌不再重複。</summary>
    private void AdvanceStage()
    {
        Stage++;
        PrepareRound();
    }

    /// <summary>
    /// 一關開打前的歸零。刻意不動 <see cref="Status"/>——
    /// 過關的那一刻狀態必須留著讓前端看見「你過關了」，不能被歸零蓋掉。
    /// </summary>
    private void PrepareRound()
    {
        Answered = 0;
        RoundScore = 0;
        _guaranteed.Clear();

        if (CurrentStage?.Unlocks is { } unlocked)
            _guaranteed.Add(unlocked);
    }

    private QuestionView ViewOf(Question question) => new(
        Number: Answered + 1,
        Total: Rules.QuestionsPerRound,
        Stage: Stage,
        StageLabel: CurrentStage is null ? null : $"第 {Stage} 關",
        ScoreToClear: CurrentStage?.ScoreToClear ?? 0,
        Seconds: Rules.QuestionTime.TotalSeconds,
        PreviewUrl: question.Answer.PreviewUrl,
        Choices: question.Choices);
}

/// <summary>送到前端的題目。刻意不含正解。</summary>
public sealed record QuestionView(
    int Number,
    int Total,
    int Stage,
    string? StageLabel,
    int ScoreToClear,
    double Seconds,
    string PreviewUrl,
    IReadOnlyList<Choice> Choices);

/// <summary>一題的判定結果。</summary>
public sealed record AnswerOutcome(
    bool Correct,
    int CorrectChoiceId,
    string CorrectLabel,
    int Gained,
    int RoundScore,
    int TotalScore,
    GameStatus Status,
    int Stage,
    int ScoreToClear);

/// <summary>結算頁要逐題回顧用的紀錄。</summary>
public sealed record AnswerRecord(
    string Title,
    string Artist,
    Language Language,
    bool Correct,
    int Gained,
    TimeSpan Elapsed);
