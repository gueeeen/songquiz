using SongQuiz.Game;

namespace SongQuiz.Game.Tests;

public class ScoringTests
{
    [Fact]
    public void 答錯一律零分()
    {
        Assert.Equal(0, Rules.ScoreFor(correct: false, TimeSpan.Zero));
        Assert.Equal(0, Rules.ScoreFor(correct: false, TimeSpan.FromSeconds(6)));
    }

    [Fact]
    public void 秒答拿滿分一千()
    {
        Assert.Equal(Rules.BaseScore + Rules.SpeedBonus, Rules.ScoreFor(correct: true, TimeSpan.Zero));
    }

    [Fact]
    public void 剛好用完十二秒才答對只拿保底()
    {
        // 12.0 秒是逾時的邊界：11.9 秒答對還有分，12.0 秒就當沒答到。
        Assert.Equal(Rules.BaseScore + 4, Rules.ScoreFor(correct: true, TimeSpan.FromSeconds(11.9)));
        Assert.Equal(0, Rules.ScoreFor(correct: true, Rules.QuestionTime));
    }

    [Fact]
    public void 一半時間拿保底加一半獎勵()
    {
        Assert.Equal(Rules.BaseScore + Rules.SpeedBonus / 2,
            Rules.ScoreFor(correct: true, TimeSpan.FromSeconds(6)));
    }

    [Fact]
    public void 滿分是一萬()
    {
        Assert.Equal(10_000, Rules.PerfectScore);
        Assert.Equal(10_000, Rules.ScoreFor(true, TimeSpan.Zero) * Rules.QuestionsPerRound);
    }

    [Fact]
    public void 六關的門檻是遞增的四千到九千()
    {
        Assert.Equal(Rules.StageCount, Rules.Stages.Count);
        Assert.Equal(4000, Rules.Stages[0].ScoreToClear);
        Assert.Equal(9000, Rules.Stages[^1].ScoreToClear);

        var thresholds = Rules.Stages.Select(s => s.ScoreToClear).ToList();
        Assert.Equal(thresholds.OrderBy(t => t), thresholds);
    }

    [Fact]
    public void 關卡的語種只會越開越多()
    {
        for (var i = 1; i < Rules.Stages.Count; i++)
        {
            var before = Rules.Stages[i - 1].Languages;
            var after = Rules.Stages[i].Languages;
            Assert.All(before, language => Assert.Contains(language, after));
        }
    }

    [Fact]
    public void 每一關新解鎖的語種都真的是新的()
    {
        var seen = new HashSet<Quiz.Language>();
        foreach (var stage in Rules.Stages)
        {
            if (stage.Unlocks is { } unlocked)
                Assert.True(seen.Add(unlocked), $"第 {stage.Number} 關重複解鎖了 {unlocked}");
            else
                foreach (var language in stage.Languages) seen.Add(language);
        }
    }
}
