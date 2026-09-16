namespace SongQuiz.BankBuilder.Tests;

/// <summary>
/// Fame 的合成方式：往下第幾首 × SongStep ＋ 歌手名次。
/// 這幾條盯的是那個權衡——第一版讓歌手名次完全主導，結果「簡單」那一級
/// 被榜首一個人的五首歌佔滿，那不是「大家認得」，是「這個月第一名」。
/// </summary>
public class FameTests
{
    private static int Fame(int songIndex, int artistRank) => songIndex * Track.SongStep + artistRank;

    [Fact]
    public void 同一位歌手越後面的歌越不有名()
    {
        Assert.True(Fame(0, 5) < Fame(1, 5));
        Assert.True(Fame(1, 5) < Fame(2, 5));
    }

    [Fact]
    public void 同一個名次的歌手越前面的歌越有名()
    {
        Assert.True(Fame(0, 1) < Fame(0, 50));
    }

    [Fact]
    public void 榜首的第二首贏過中後段的第一首()
    {
        // 名次還是要有份量，不然「簡單」會變成一堆沒人聽過的歌手的代表作。
        // SongStep 20 的意思就是：往下一首，代價是掉 20 個名次。
        Assert.True(Fame(1, 0) < Fame(0, 25), "榜首的第二首應該排在第 25 名的第一首前面");
    }

    [Fact]
    public void 這個權衡是有代價的要講清楚()
    {
        // 反過來說，榜首的第五首（Fame 80）會贏過第 80 名的第一首（Fame 80 後面）。
        // 也就是說一位超級巨星的五首歌全都會進「簡單」那一級。
        //
        // 這是刻意接受的：超級巨星的第五首歌，多數人確實比冷門歌手的代表作熟。
        // 要避免的是**第一版那種**——名次乘 100，讓榜首一個人佔滿前五名、
        // 而「簡單」只橫跨二十幾位歌手。
        Assert.True(Fame(4, 0) > Fame(0, 79), "第 79 名的代表作應該還是排在榜首的第五首前面");
    }

    [Fact]
    public void 簡單那一級橫跨的歌手數要夠多()
    {
        // 直接量結果：80 位歌手各 5 首、共 400 首，切 40/30/30 之後，
        // 「簡單」那 160 首應該來自幾十位歌手，不是二十幾位。
        var tracks = new List<Track>();

        for (var rank = 0; rank < 80; rank++)
        {
            for (var index = 0; index < 5; index++)
            {
                tracks.Add(new Track(rank * 10 + index, $"歌{rank}-{index}", $"歌手{rank}",
                    Language.Mandarin, "u")
                {
                    Fame = Fame(index, rank),
                });
            }
        }

        var easy = Difficulty.Assign(tracks).Where(t => t.Tier == 0).ToList();
        var artists = easy.Select(t => t.Artist).Distinct().Count();

        Assert.Equal(160, easy.Count);
        Assert.True(artists >= 60, $"「簡單」只來自 {artists} 位歌手，太集中了");
    }
}
