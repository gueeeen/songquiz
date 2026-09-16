namespace SongQuiz.BankBuilder.Tests;

/// <summary>
/// 難度是「在同語種裡依知名度排序的相對位置」。這幾條盯的是那個切法，
/// 以及一個容易被忽略的前提：**每個語種各自切**。
/// </summary>
public class DifficultyTests
{
    private static Track Make(int fame, Language language) =>
        new(fame, $"歌{fame}", "甲", language, "u") { Fame = fame };

    [Fact]
    public void 前一半簡單接下來四分之一中等最後四分之一困難()
    {
        var tracks = Enumerable.Range(0, 100).Select(i => Make(i, Language.Mandarin));

        var tagged = Difficulty.Assign(tracks);

        Assert.Equal(50, tagged.Count(t => t.Tier == 0));
        Assert.Equal(25, tagged.Count(t => t.Tier == 1));
        Assert.Equal(25, tagged.Count(t => t.Tier == 2));
    }

    [Fact]
    public void Fame越小越有名所以排前面()
    {
        // Fame 是「越小越有名」。搞反的話整個分級會上下顛倒，
        // 而且從外面看不出來——出題會偏向最冷門的歌。
        var tagged = Difficulty.Assign([Make(0, Language.Mandarin), Make(999, Language.Mandarin)]);

        Assert.Equal(0, tagged.Single(t => t.Fame == 0).Tier);
        Assert.Equal(2, tagged.Single(t => t.Fame == 999).Tier);
    }

    [Fact]
    public void 每個語種各自切不是全部混在一起切()
    {
        // 混著切的話，歌手普遍比較紅的語種會把另一個語種整個推到「困難」。
        // 玩家選的是語種，所以難度必須在語種內部相對。
        var tracks = new List<Track>();
        for (var i = 0; i < 100; i++) tracks.Add(Make(i, Language.Mandarin));
        for (var i = 500; i < 600; i++) tracks.Add(Make(i, Language.Taiwanese));

        var tagged = Difficulty.Assign(tracks);

        foreach (var language in new[] { Language.Mandarin, Language.Taiwanese })
        {
            var group = tagged.Where(t => t.Language == language).ToList();
            Assert.Equal(50, group.Count(t => t.Tier == 0));
            Assert.Equal(25, group.Count(t => t.Tier == 1));
            Assert.Equal(25, group.Count(t => t.Tier == 2));
        }
    }

    [Fact]
    public void 歌很少的時候也不會漏掉任何一首()
    {
        // 三首歌怎麼切都不會漂亮，但不能有歌消失——
        // 消失的那幾首會永遠不出現，而且沒有人會發現。
        var tagged = Difficulty.Assign([
            Make(0, Language.Korean),
            Make(1, Language.Korean),
            Make(2, Language.Korean),
        ]);

        Assert.Equal(3, tagged.Count);
        Assert.All(tagged, t => Assert.InRange(t.Tier, 0, 2));
    }

    [Fact]
    public void 空的也不會爆()
    {
        Assert.Empty(Difficulty.Assign([]));
    }
}
