namespace SongQuiz.BankBuilder.Tests;

/// <summary>
/// BankReader 是「每個月合併」的基礎，而它失敗的時候是**靜默**回 null。
/// 那個設計是刻意的（讀不懂上一版不該讓建置失敗），但代價是：
/// 它哪天壞掉，月度合併會無聲無息停止運作，題庫每個月變成整批覆蓋，
/// 沒有人會發現。所以它需要測試。
/// </summary>
public class BankReaderTests
{
    private const string RealPrefix = "https://audio-ssl.itunes.apple.com/itunes-assets/";
    private const string RealSuffix = ".plus.aac.p.m4a";
    private const string Middle = "AudioPreview221/v4/99/06/52/99065271-bfaa/mzaf_1331049066292070931";
    private const string OddUrl = "https://audio-ssl.itunes.apple.com/itunes-assets/Music/7f/mzm.psvckgpm.aac.p.m4a";

    private static string Temp() => Path.Combine(Path.GetTempPath(), $"bank-{Guid.NewGuid():n}.js");

    [Fact]
    public void 寫出去再讀回來內容一模一樣()
    {
        var original = new SongBank
        {
            Tracks =
            [
                new Track(1, "晴天", "周杰倫", Language.Mandarin, RealPrefix + Middle + RealSuffix),
                new Track(2, "浪流連", "茄子蛋", Language.Taiwanese, OddUrl),
                new Track(3, "Anti-Hero", "Taylor Swift", Language.Western, RealPrefix + Middle + RealSuffix),
            ],
            Decoys =
            [
                new Decoy("稻香", "周杰倫", Language.Mandarin),
                new Decoy("가을 아침", "IU", Language.Korean),
            ],
        };

        var path = Temp();

        try
        {
            original.Save(path);
            var read = BankReader.TryRead(path);

            Assert.NotNull(read);
            Assert.Equal(original.Tracks.Count, read!.Value.Tracks.Count);
            Assert.Equal(original.Decoys.Count, read.Value.Decoys.Count);

            // 逐項比對。這裡真正在測的是「縮短過的網址拼得回來」
            // 與「語種索引換得回原本的 enum」這兩件事。
            for (var i = 0; i < original.Tracks.Count; i++)
            {
                Assert.Equal(original.Tracks[i].Id, read.Value.Tracks[i].Id);
                Assert.Equal(original.Tracks[i].Title, read.Value.Tracks[i].Title);
                Assert.Equal(original.Tracks[i].Artist, read.Value.Tracks[i].Artist);
                Assert.Equal(original.Tracks[i].Language, read.Value.Tracks[i].Language);
                Assert.Equal(original.Tracks[i].PreviewUrl, read.Value.Tracks[i].PreviewUrl);
            }

            for (var i = 0; i < original.Decoys.Count; i++)
            {
                Assert.Equal(original.Decoys[i].Title, read.Value.Decoys[i].Title);
                Assert.Equal(original.Decoys[i].Artist, read.Value.Decoys[i].Artist);
                Assert.Equal(original.Decoys[i].Language, read.Value.Decoys[i].Language);
            }
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void 中文和韓文都讀得回來()
    {
        // 這一條盯的是「不逃逸成 \uXXXX」那個改動有沒有破壞往返。
        var bank = new SongBank
        {
            Tracks = [new Track(1, "甲乙丙丁Strangers", "李佳薇", Language.Mandarin, OddUrl)],
            Decoys = [new Decoy("좋은 날", "아이유", Language.Korean)],
        };

        var path = Temp();

        try
        {
            bank.Save(path);
            var read = BankReader.TryRead(path);

            Assert.NotNull(read);
            Assert.Equal("甲乙丙丁Strangers", read!.Value.Tracks[0].Title);
            Assert.Equal("李佳薇", read.Value.Tracks[0].Artist);
            Assert.Equal("좋은 날", read.Value.Decoys[0].Title);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void 檔案不在就回null不丟例外()
    {
        // 第一次建題庫的時候沒有上一版，那不是錯。
        Assert.Null(BankReader.TryRead(Path.Combine(Path.GetTempPath(), "bank-不存在.js")));
    }

    [Theory]
    [InlineData("這不是題庫")]
    [InlineData("(function(){var b={壞掉的 JSON;function u(s){}})();")]
    [InlineData("window.SONG_BANK={\"tracks\":[]};")]   // 舊格式：認不得，不該猜
    public void 讀不懂就回null不丟例外(string content)
    {
        // 合併只是加分，不該變成建置失敗的理由——尤其這是個跑十幾分鐘的工作。
        var path = Temp();

        try
        {
            File.WriteAllText(path, content);
            Assert.Null(BankReader.TryRead(path));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void 索引表變長了舊檔案仍然讀得對()
    {
        // 之後開放粵語時，索引表會多一個值。
        // 索引刻意放「所有分得出來的語種」而不是「寫進題庫的那幾個」，
        // 就是為了讓既有語種的索引不位移——否則舊檔案配新程式會整批認錯語種。
        var path = Temp();

        try
        {
            new SongBank
            {
                Tracks = [new Track(1, "a", "甲", Language.Japanese, OddUrl)],
                Decoys = [],
            }.Save(path);

            var text = File.ReadAllText(path);
            Assert.Contains("\"cantonese\"", text);

            var read = BankReader.TryRead(path);
            Assert.NotNull(read);
            Assert.Equal(Language.Japanese, read!.Value.Tracks[0].Language);
        }
        finally
        {
            File.Delete(path);
        }
    }
}
