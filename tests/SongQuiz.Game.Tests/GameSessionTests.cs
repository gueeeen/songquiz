using SongQuiz.Common;
using SongQuiz.Quiz;

namespace SongQuiz.Game.Tests;

public class GameSessionTests
{
    private static readonly DateTimeOffset T0 = new(2026, 9, 13, 12, 0, 0, TimeSpan.Zero);

    /// <summary>每個語種都夠多歌的假題庫，讓六關跑得完。</summary>
    private static SongBank FullBank(int perLanguage = 40)
    {
        var tracks = new List<Track>();
        var id = 1L;
        foreach (var language in Enum.GetValues<Language>())
            for (var i = 0; i < perLanguage; i++)
            {
                tracks.Add(new Track(id, $"{language}-{i}", $"歌手{i}", language, $"https://example.test/{id}.m4a"));
                id++;
            }

        return new SongBank { Tracks = tracks, Decoys = [] };
    }

    private static (GameSession Session, FakeClock Clock) NewGame(GameMode mode, SongBank? bank = null)
    {
        var clock = new FakeClock(T0);
        return (new GameSession("t", mode, bank ?? FullBank(), clock, new Random(1)), clock);
    }

    /// <summary>答對現在這一題。正解只有 internal 才拿得到——前端拿不到。</summary>
    private static AnswerOutcome AnswerCorrectly(GameSession session)
    {
        var question = session.CurrentQuestion ?? throw new InvalidOperationException("現在沒有題目");
        return session.Answer(question.AnswerId);
    }

    /// <summary>答錯現在這一題（挑一個不是正解的編號）。</summary>
    private static AnswerOutcome AnswerWrongly(GameSession session)
    {
        var question = session.CurrentQuestion ?? throw new InvalidOperationException("現在沒有題目");
        return session.Answer(question.AnswerId == 0 ? 1 : 0);
    }

    /// <summary>全對、且都在寬限時間內答完一整關（= 這一關滿分）。</summary>
    private static void PerfectRound(GameSession session, FakeClock clock)
    {
        for (var i = 0; i < Rules.QuestionsPerRound; i++)
        {
            Assert.NotNull(session.NextQuestion());
            clock.Advance(Rules.LatencyGrace);
            AnswerCorrectly(session);
        }
    }

    [Fact]
    public void 競速模式十題答完就結束()
    {
        var (session, clock) = NewGame(GameMode.Speed);

        for (var i = 0; i < Rules.QuestionsPerRound; i++)
        {
            var view = session.NextQuestion();
            Assert.NotNull(view);
            Assert.Equal(i + 1, view.Number);
            Assert.Equal(Rules.QuestionsPerRound, view.Total);
            Assert.Equal(QuestionMaker.ChoiceCount, view.Choices.Count);
            Assert.Null(view.StageLabel);

            clock.Advance(TimeSpan.FromSeconds(2));
            AnswerWrongly(session);
        }

        Assert.Equal(GameStatus.Finished, session.Status);
        Assert.Null(session.NextQuestion());
    }

    [Fact]
    public void 全對秒答就是滿分一萬()
    {
        var (session, clock) = NewGame(GameMode.Speed);

        PerfectRound(session, clock);

        Assert.Equal(Rules.PerfectScore, session.TotalScore);
        Assert.Equal(GameStatus.Finished, session.Status);
    }

    [Fact]
    public void 沒作答等於答錯零分()
    {
        var (session, clock) = NewGame(GameMode.Speed);
        session.NextQuestion();
        clock.Advance(Rules.QuestionTime);

        var outcome = session.Answer(choiceId: null);

        Assert.False(outcome.Correct);
        Assert.Equal(0, outcome.Gained);
        Assert.Equal(0, session.TotalScore);
    }

    [Fact]
    public void 逾時才答對也是零分()
    {
        var (session, clock) = NewGame(GameMode.Speed);
        session.NextQuestion();
        clock.Advance(TimeSpan.FromSeconds(30));

        var outcome = AnswerCorrectly(session);

        Assert.True(outcome.Correct);
        Assert.Equal(0, outcome.Gained);
    }

    [Fact]
    public void 網路延遲的寬限不算在玩家頭上()
    {
        var (session, clock) = NewGame(GameMode.Speed);
        session.NextQuestion();
        clock.Advance(Rules.LatencyGrace);

        Assert.Equal(Rules.BaseScore + Rules.SpeedBonus, AnswerCorrectly(session).Gained);
    }

    [Fact]
    public void 答完之後會回報正解讓前端標出來()
    {
        var (session, clock) = NewGame(GameMode.Speed);
        var view = session.NextQuestion()!;
        clock.Advance(TimeSpan.FromSeconds(1));

        var outcome = AnswerWrongly(session);

        Assert.False(outcome.Correct);
        Assert.Contains(outcome.CorrectLabel, view.Choices.Select(c => c.Label));
        Assert.Equal(outcome.CorrectLabel, view.Choices.Single(c => c.Id == outcome.CorrectChoiceId).Label);
    }

    [Fact]
    public void 沒有題目的時候作答會被擋掉()
    {
        var (session, _) = NewGame(GameMode.Speed);

        Assert.Throws<InvalidOperationException>(() => session.Answer(0));
    }

    [Fact]
    public void 同一題不能答兩次()
    {
        var (session, clock) = NewGame(GameMode.Speed);
        session.NextQuestion();
        clock.Advance(TimeSpan.FromSeconds(1));
        session.Answer(0);

        Assert.Throws<InvalidOperationException>(() => session.Answer(1));
    }

    [Fact]
    public void 闖關模式從第一關開始門檻四千()
    {
        var (session, _) = NewGame(GameMode.Stage);

        Assert.Equal(1, session.Stage);

        var view = session.NextQuestion()!;
        Assert.Equal("第 1 關", view.StageLabel);
        Assert.Equal(4000, view.ScoreToClear);
        Assert.Equal(Language.Mandarin, session.CurrentQuestion!.Answer.Language);
    }

    [Fact]
    public void 闖關分數不夠就失敗()
    {
        var (session, clock) = NewGame(GameMode.Stage);

        for (var i = 0; i < Rules.QuestionsPerRound; i++)
        {
            session.NextQuestion();
            clock.Advance(TimeSpan.FromSeconds(1));
            session.Answer(choiceId: null); // 全部放空
        }

        Assert.Equal(GameStatus.StageFailed, session.Status);
        Assert.Equal(0, session.RoundScore);
        Assert.Null(session.NextQuestion());
    }

    [Fact]
    public void 剛好踩在門檻上算過關()
    {
        // 前四題秒答（每題滿分 1000）＝ 4000，剩下六題全錯 → 剛好踩在第一關門檻。
        var (session, clock) = NewGame(GameMode.Stage);

        var last = PlayRound(session, clock, perfect: 4, slowCorrect: 0);

        Assert.Equal(4000, last.RoundScore);
        Assert.Equal(GameStatus.StageCleared, last.Status);
    }

    [Fact]
    public void 只差一分就沒過關()
    {
        // 門檻是硬的：3999 不過，沒有「差一點就讓你過」。
        var (session, clock) = NewGame(GameMode.Stage);

        var last = PlayRound(session, clock, perfect: 3, slowCorrect: 1);

        Assert.Equal(3999, last.RoundScore);
        Assert.Equal(GameStatus.StageFailed, last.Status);
    }

    /// <summary>
    /// 打完一整關：先 <paramref name="perfect"/> 題秒答滿分，
    /// 接著 <paramref name="slowCorrect"/> 題慢 24 毫秒答對（999 分），其餘全錯。
    /// </summary>
    private static AnswerOutcome PlayRound(
        GameSession session, FakeClock clock, int perfect, int slowCorrect)
    {
        AnswerOutcome? last = null;

        for (var i = 0; i < Rules.QuestionsPerRound; i++)
        {
            session.NextQuestion();

            if (i < perfect)
            {
                clock.Advance(Rules.LatencyGrace);
                last = AnswerCorrectly(session);
            }
            else if (i < perfect + slowCorrect)
            {
                clock.Advance(Rules.LatencyGrace + TimeSpan.FromMilliseconds(24));
                last = AnswerCorrectly(session);
            }
            else
            {
                clock.Advance(TimeSpan.FromSeconds(1));
                last = AnswerWrongly(session);
            }
        }

        return last!;
    }

    [Fact]
    public void 闖關過了就進下一關題數與分數重新起算()
    {
        var (session, clock) = NewGame(GameMode.Stage);

        PerfectRound(session, clock);

        // 過關的那一刻就已經在第二關了，不必等到下一題才生效。
        Assert.Equal(GameStatus.StageCleared, session.Status);
        Assert.Equal(2, session.Stage);
        Assert.Equal(0, session.RoundScore);
        Assert.Equal(Rules.PerfectScore, session.TotalScore); // 累積分數不會被歸零

        var view = session.NextQuestion()!;

        Assert.Equal("第 2 關", view.StageLabel);
        Assert.Equal(1, view.Number);
        Assert.Equal(5000, view.ScoreToClear);
    }

    [Fact]
    public void 過關的回報講的是剛打完的那一關()
    {
        // 前端要顯示「第 1 關過關！」，所以回報必須是舊關卡編號與那一關的分數，
        // 即使狀態機內部已經推進到第二關。
        var (session, clock) = NewGame(GameMode.Stage);

        AnswerOutcome? last = null;
        for (var i = 0; i < Rules.QuestionsPerRound; i++)
        {
            session.NextQuestion();
            clock.Advance(Rules.LatencyGrace);
            last = AnswerCorrectly(session);
        }

        Assert.Equal(GameStatus.StageCleared, last!.Status);
        Assert.Equal(1, last.Stage);
        Assert.Equal(4000, last.ScoreToClear);
        Assert.Equal(Rules.PerfectScore, last.RoundScore);
        Assert.Equal(2, session.Stage);
    }

    [Fact]
    public void 六關全破整場結束()
    {
        var (session, clock) = NewGame(GameMode.Stage, FullBank(80));

        for (var stage = 1; stage <= Rules.StageCount; stage++)
        {
            Assert.Equal(stage, session.Stage);
            PerfectRound(session, clock);
        }

        Assert.Equal(GameStatus.Finished, session.Status);
        Assert.Equal(Rules.StageCount, session.Stage);
        Assert.Equal(Rules.PerfectScore * Rules.StageCount, session.TotalScore);
        Assert.Equal(Rules.QuestionsPerRound * Rules.StageCount, session.Records.Count);
    }

    [Fact]
    public void 每一關新解鎖的語種至少出一題()
    {
        // 第二關解鎖台語，那一關就不能整關都是華語，否則解鎖等於沒發生。
        var (session, clock) = NewGame(GameMode.Stage, FullBank(80));

        PerfectRound(session, clock); // 第一關
        PerfectRound(session, clock); // 第二關

        var stageTwo = session.Records.Skip(Rules.QuestionsPerRound).Select(r => r.Language).ToList();

        Assert.Equal(Rules.QuestionsPerRound, stageTwo.Count);
        Assert.Contains(Language.Taiwanese, stageTwo);
    }

    [Fact]
    public void 第一關不會出現還沒解鎖的語種()
    {
        var (session, clock) = NewGame(GameMode.Stage, FullBank(80));

        PerfectRound(session, clock);

        Assert.All(session.Records, r => Assert.Equal(Language.Mandarin, r.Language));
    }

    [Fact]
    public void 整場不會重複出同一首歌()
    {
        var (session, clock) = NewGame(GameMode.Stage, FullBank(80));

        for (var stage = 1; stage <= 3; stage++) PerfectRound(session, clock);

        var songs = session.Records.Select(r => $"{r.Title}|{r.Artist}").ToList();
        Assert.Equal(songs.Count, songs.Distinct().Count());
    }

    [Fact]
    public void 題庫湊不出題時回null而不是丟例外()
    {
        var thin = new SongBank
        {
            Tracks = [new Track(1, "唯一一首", "甲", Language.Mandarin, "https://example.test/1.m4a")],
            Decoys = [],
        };
        var (session, clock) = NewGame(GameMode.Speed, thin);

        Assert.NotNull(session.NextQuestion());
        clock.Advance(TimeSpan.FromSeconds(1));
        session.Answer(0);

        Assert.Null(session.NextQuestion());
    }

    [Fact]
    public void 作答紀錄留下每一題的歌名對錯與秒數()
    {
        var (session, clock) = NewGame(GameMode.Speed);
        session.NextQuestion();
        var answer = session.CurrentQuestion!.Answer;
        clock.Advance(Rules.LatencyGrace + TimeSpan.FromSeconds(3));
        AnswerCorrectly(session);

        var record = Assert.Single(session.Records);
        Assert.Equal(answer.Title, record.Title);
        Assert.Equal(answer.Artist, record.Artist);
        Assert.True(record.Correct);
        Assert.Equal(3, record.Elapsed.TotalSeconds, precision: 1);
    }
}
