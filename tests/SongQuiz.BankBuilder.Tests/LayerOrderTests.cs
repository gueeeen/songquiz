namespace SongQuiz.BankBuilder.Tests;

/// <summary>
/// 題庫是三層疊出來的，而「哪一層排在前面」就決定了難度分級怎麼切。
/// 這幾條盯的是那個順序——它沒有型別保護，只是三個不同量級的 Fame。
/// </summary>
public class LayerOrderTests
{
    // 和 Program.cs 用的是同一組數字。改了那邊沒改這邊，這些測試會紅。
    private const int ChartBase = -200000;
    private const int ClassicBase = -100000;

    private static Track Track(string title, int fame, Language language = Language.Mandarin) =>
        new(title.GetHashCode(), title, "甲", language, "u") { Fame = fame };

    [Fact]
    public void 榜上的歌排在經典前面經典排在搜尋來的前面()
    {
        // 榜上第 50 名（最後一名）仍然要贏過經典的第一首，
        // 否則「流動性」那一層會被經典擠掉。
        Assert.True(ChartBase + 49 < ClassicBase + 0);

        // 經典的最後一首（512 首裡的最後）仍然要贏過搜尋來的第一首。
        Assert.True(ClassicBase + 511 < 0);
    }

    [Fact]
    public void 三層疊起來之後簡單那一級是榜上的歌加經典()
    {
        // 每語種 400 首、簡單佔 40%（160 首）。
        // 榜上 50 首 ＋ 經典 110 首就填滿了，搜尋來的排不進去。
        var tracks = new List<Track>();

        for (var i = 0; i < 50; i++) tracks.Add(Track($"榜{i}", ChartBase + i));
        for (var i = 0; i < 160; i++) tracks.Add(Track($"經典{i}", ClassicBase + i));
        for (var i = 0; i < 190; i++) tracks.Add(Track($"搜尋{i}", i * 20));

        var easy = Difficulty.Assign(tracks).Where(t => t.Tier == 0).ToList();

        Assert.Equal(160, easy.Count);
        Assert.Equal(50, easy.Count(t => t.Title.StartsWith("榜")));
        Assert.Equal(110, easy.Count(t => t.Title.StartsWith("經典")));
        Assert.Empty(easy.Where(t => t.Title.StartsWith("搜尋")));
    }

    [Fact]
    public void 經典不夠的語種會用搜尋來的補滿簡單那一級()
    {
        // 台語、韓語、日語的經典各只有 80 首。50 ＋ 80 = 130，
        // 離 160 還差 30——那 30 個名額要用搜尋來的填，不能空著。
        var tracks = new List<Track>();

        for (var i = 0; i < 50; i++) tracks.Add(Track($"榜{i}", ChartBase + i));
        for (var i = 0; i < 80; i++) tracks.Add(Track($"經典{i}", ClassicBase + i));
        for (var i = 0; i < 270; i++) tracks.Add(Track($"搜尋{i}", i * 20));

        var easy = Difficulty.Assign(tracks).Where(t => t.Tier == 0).ToList();

        Assert.Equal(160, easy.Count);
        Assert.Equal(50, easy.Count(t => t.Title.StartsWith("榜")));
        Assert.Equal(80, easy.Count(t => t.Title.StartsWith("經典")));
        Assert.Equal(30, easy.Count(t => t.Title.StartsWith("搜尋")));
    }

    [Fact]
    public void 榜上的歌一定進得了簡單那一級()
    {
        // 這是「流動性」的保證：不管經典有多少，榜上那幾十首都在最前面。
        // 沒有這一條的話，經典一多就會把當月的新歌整批擠到「中等」去。
        var tracks = new List<Track>();

        for (var i = 0; i < 50; i++) tracks.Add(Track($"榜{i}", ChartBase + i));
        for (var i = 0; i < 350; i++) tracks.Add(Track($"經典{i}", ClassicBase + i));

        var tagged = Difficulty.Assign(tracks);

        Assert.All(tagged.Where(t => t.Title.StartsWith("榜")), t => Assert.Equal(0, t.Tier));
    }
}
