using System.Text.Json;

namespace SongQuiz.BankBuilder.Tests;

/// <summary>
/// 這些測試守的是「網頁端讀得懂題庫檔」這個契約。
/// 它跨語言（C# 寫、JavaScript 讀），編譯器管不到，所以只能靠測試釘住。
/// </summary>
public class SongBankTests
{
    private static SongBank Sample() => new()
    {
        Tracks =
        [
            new Track(1, "晴天", "周杰倫", Language.Mandarin, "https://example.test/1.m4a"),
            new Track(2, "浪流連", "茄子蛋", Language.Taiwanese, "https://example.test/2.m4a"),
        ],
        Decoys = [new Decoy("稻香", "周杰倫", Language.Mandarin)],
    };

    private static string SaveToTemp(SongBank bank)
    {
        var path = Path.Combine(Path.GetTempPath(), $"bank-{Guid.NewGuid():n}.js");
        bank.Save(path);
        return path;
    }

    [Fact]
    public void 產出的是掛在全域變數上的一行JS()
    {
        // 這一行的形狀就是 file:// 能玩的原因：<script src> 不受同源限制，
        // 換成 JSON 加 fetch 就會在雙擊開啟時被 CORS 擋死。
        var path = SaveToTemp(Sample());

        try
        {
            var text = File.ReadAllText(path);

            Assert.StartsWith("window.SONG_BANK={", text);
            Assert.EndsWith("};\n", text);
            Assert.Single(text.TrimEnd('\n').Split('\n'));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void 欄位名與語種都是網頁端認得的camelCase()
    {
        var path = SaveToTemp(Sample());

        try
        {
            var json = File.ReadAllText(path)
                .Replace("window.SONG_BANK=", string.Empty)
                .TrimEnd('\n', ';');

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            Assert.True(root.TryGetProperty("generatedAt", out _));
            var track = root.GetProperty("tracks")[0];

            Assert.Equal(1, track.GetProperty("id").GetInt64());
            Assert.Equal("晴天", track.GetProperty("title").GetString());
            Assert.Equal("周杰倫", track.GetProperty("artist").GetString());
            Assert.Equal("mandarin", track.GetProperty("language").GetString());
            Assert.Equal("https://example.test/1.m4a", track.GetProperty("previewUrl").GetString());

            // Label 是算出來的，網頁端自己會拼。輸出它只是讓檔案變大。
            Assert.False(track.TryGetProperty("label", out _));

            var decoy = root.GetProperty("decoys")[0];
            Assert.Equal("稻香", decoy.GetProperty("title").GetString());
            Assert.Equal("mandarin", decoy.GetProperty("language").GetString());
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void 輸出全是ASCII不怕編碼問題()
    {
        // 中文被序列化成 \uXXXX。這樣不管誰用什麼編碼開這個檔都不會壞，
        // 也不必擔心 BOM 跑進 <script> 造成語法錯誤。
        var path = SaveToTemp(Sample());

        try
        {
            var bytes = File.ReadAllBytes(path);
            Assert.All(bytes, b => Assert.True(b < 0x80, $"出現非 ASCII 位元組 0x{b:X2}"));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void 語種統計數得對()
    {
        var bank = new SongBank
        {
            Tracks =
            [
                new Track(1, "a", "甲", Language.Mandarin, "u"),
                new Track(2, "b", "乙", Language.Mandarin, "u"),
                new Track(3, "c", "丙", Language.Korean, "u"),
            ],
            Decoys = [],
        };

        var census = bank.Census();

        Assert.Equal(2, census[Language.Mandarin]);
        Assert.Equal(1, census[Language.Korean]);
        Assert.False(census.ContainsKey(Language.Japanese));
    }

    [Fact]
    public void 輸出目錄不存在會自己建()
    {
        // 新 clone 下來的人第一次跑重建題庫，web/data 還不存在。
        var dir = Path.Combine(Path.GetTempPath(), $"bankdir-{Guid.NewGuid():n}");
        var path = Path.Combine(dir, "data", "bank.js");

        try
        {
            Sample().Save(path);
            Assert.True(File.Exists(path));
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
    }
}
