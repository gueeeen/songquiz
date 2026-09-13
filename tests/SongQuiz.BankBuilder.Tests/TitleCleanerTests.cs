namespace SongQuiz.BankBuilder.Tests;

public class TitleCleanerTests
{
    [Theory]
    [InlineData("晴天", "晴天")]
    [InlineData("你,好不好?", "你,好不好?")]                       // 歌名自己的標點不能被當成註記
    [InlineData("Love Story (Taylor's Version)", "Love Story")]
    [InlineData("告白氣球 (Live)", "告白氣球")]
    [InlineData("Perfect [Remastered]", "Perfect")]
    [InlineData("小幸運（電影主題曲）", "小幸運")]
    [InlineData("Shape of You - Single Version", "Shape of You")]
    [InlineData("魚仔  (feat. 某人)", "魚仔")]
    public void 只砍註記不動主歌名(string raw, string expected)
    {
        Assert.Equal(expected, TitleCleaner.Clean(raw));
    }

    [Theory]
    // 以下三筆都是 Apple 的真實歌名。註記裡還巢著一組括號時，
    // 清一輪只會拔掉內層，留下「你,好不好?(TVBS連續劇片尾曲)」——所以要清到不再變動。
    [InlineData("你,好不好?(TVBS連續劇【遺憾拼圖】片尾曲)", "你,好不好?")]
    [InlineData("All For You (《蜘蛛人:重生日》電影片尾曲)", "All For You")]
    [InlineData("最後一堂課 (《媽,別鬧了!》影集片尾曲)", "最後一堂課")]
    public void 巢狀括號要清到底(string raw, string expected)
    {
        Assert.Equal(expected, TitleCleaner.Clean(raw));
    }

    [Fact]
    public void 不成對的括號不會留在歌名上()
    {
        Assert.Equal("歌名", TitleCleaner.Clean("歌名)"));
        Assert.Equal("歌名", TitleCleaner.Clean("歌名（"));
    }

    [Fact]
    public void 整個歌名都是註記時保留原名()
    {
        // 清成空字串比留著註記更糟——選項會變成一片空白。
        Assert.Equal("(Intro)", TitleCleaner.Clean("(Intro)"));
    }

    [Fact]
    public void 不會留下首尾的空白或分隔標點()
    {
        Assert.Equal("稻香", TitleCleaner.Clean("  稻香 (Album Version) ,  "));
    }
}
