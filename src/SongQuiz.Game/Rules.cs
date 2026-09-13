using SongQuiz.Quiz;

namespace SongQuiz.Game;

/// <summary>兩種玩法。</summary>
public enum GameMode
{
    /// <summary>競速：十題，每題十二秒，滿分一萬。</summary>
    Speed,

    /// <summary>闖關：六關，每關十題，過關看分數，語種一關一關解鎖。</summary>
    Stage,
}

/// <summary>一場遊戲現在處於什麼狀態。</summary>
public enum GameStatus
{
    /// <summary>題目已出，等作答。</summary>
    AwaitingAnswer,

    /// <summary>剛答完一題，等前端喊下一題。</summary>
    BetweenQuestions,

    /// <summary>這一關結束了，分數夠，可以往下一關。</summary>
    StageCleared,

    /// <summary>這一關結束了，分數不夠——闖關模式從第一關重來。</summary>
    StageFailed,

    /// <summary>整場結束（競速答完十題，或闖關打穿第六關）。</summary>
    Finished,
}

/// <summary>
/// 所有數字都集中在這裡。要調整難度就改這一個檔案，不必翻遍狀態機。
/// </summary>
public static class Rules
{
    /// <summary>每題作答時間。</summary>
    public static readonly TimeSpan QuestionTime = TimeSpan.FromSeconds(12);

    /// <summary>每關／每場的題數。</summary>
    public const int QuestionsPerRound = 10;

    /// <summary>答對的保底分。答對就算只剩一瞬間也拿得到。</summary>
    public const int BaseScore = 500;

    /// <summary>按剩餘時間給的獎勵上限。滿分 = (BaseScore + SpeedBonus) × 題數 = 10000。</summary>
    public const int SpeedBonus = 500;

    /// <summary>
    /// 前端按下答案、封包飛到伺服器的時間不該算在玩家頭上。
    /// 伺服器只負責計時，但扣掉這段寬限，讓畫面上的秒數和計分對得起來。
    /// </summary>
    public static readonly TimeSpan LatencyGrace = TimeSpan.FromMilliseconds(250);

    /// <summary>闖關模式共六關。</summary>
    public const int StageCount = 6;

    /// <summary>
    /// 闖關模式的每一關：要幾分才過得去、開放哪些語種、這一關新解鎖什麼。
    /// </summary>
    /// <remarks>
    /// 新解鎖的語種從該關起「保證至少出一題」（見 <see cref="GameSession"/>），
    /// 否則第三關解鎖了西洋歌，玩家卻可能整關都在聽華語，關卡等於沒有意義。
    /// </remarks>
    public static readonly IReadOnlyList<StageRule> Stages =
    [
        new(1, 4000, [Language.Mandarin], null),
        new(2, 5000, [Language.Mandarin, Language.Taiwanese], Language.Taiwanese),
        new(3, 6000, [Language.Mandarin, Language.Taiwanese, Language.Western], Language.Western),
        new(4, 7000, [Language.Mandarin, Language.Taiwanese, Language.Western, Language.Korean], Language.Korean),
        new(5, 8000, [Language.Mandarin, Language.Taiwanese, Language.Western, Language.Korean, Language.Japanese], Language.Japanese),
        new(6, 9000, [Language.Mandarin, Language.Taiwanese, Language.Western, Language.Korean, Language.Japanese], null),
    ];

    /// <summary>競速模式吃全部語種。</summary>
    public static readonly IReadOnlyList<Language> AllLanguages =
        Enum.GetValues<Language>();

    /// <summary>
    /// 這一題得幾分。答錯、逾時、沒作答都是零分——沒有部分給分。
    /// </summary>
    /// <param name="correct">答對了嗎。</param>
    /// <param name="elapsed">從出題到作答經過多久（已扣掉寬限）。</param>
    public static int ScoreFor(bool correct, TimeSpan elapsed)
    {
        if (!correct) return 0;
        if (elapsed >= QuestionTime) return 0;

        var left = (QuestionTime - elapsed).TotalSeconds / QuestionTime.TotalSeconds;
        return BaseScore + (int)Math.Round(SpeedBonus * Math.Clamp(left, 0, 1));
    }

    /// <summary>一場（或一關）的滿分。</summary>
    public const int PerfectScore = (BaseScore + SpeedBonus) * QuestionsPerRound;
}

/// <summary>一關的規則。</summary>
/// <param name="Number">第幾關，從 1 起算。</param>
/// <param name="ScoreToClear">過關門檻。</param>
/// <param name="Languages">這一關會出現的語種。</param>
/// <param name="Unlocks">這一關新解鎖的語種，沒有就是 null。</param>
public sealed record StageRule(
    int Number,
    int ScoreToClear,
    IReadOnlyList<Language> Languages,
    Language? Unlocks);
