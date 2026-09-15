using System.Text;
using System.Text.Json;

namespace SongQuiz.BankBuilder.Tests;

/// <summary>
/// 這些測試守的是「網頁端讀得懂題庫檔」這個契約。
/// 它跨語言（C# 寫、JavaScript 讀），編譯器管不到，所以只能靠測試釘住。
/// </summary>
public class SongBankTests
{
    private const string RealPrefix = "https://audio-ssl.itunes.apple.com/itunes-assets/";
    private const string RealSuffix = ".plus.aac.p.m4a";
    private const string Middle = "AudioPreview221/v4/99/06/52/99065271-bfaa/mzaf_1331049066292070931";

    private static SongBank Sample() => new()
    {
        Tracks =
        [
            new Track(1, "晴天", "周杰倫", Language.Mandarin, RealPrefix + Middle + RealSuffix),
            // 第二首刻意用不合前後綴的網址：Apple 有兩種資產路徑，
            // 實測兩千多首裡有兩首長這樣，那條退路是真的會被踩到的。
            new Track(2, "浪流連", "茄子蛋", Language.Taiwanese, "https://audio-ssl.itunes.apple.com/itunes-assets/Music/7f/mzm.psvckgpm.aac.p.m4a"),
        ],
        Decoys = [new Decoy("稻香", "周杰倫", Language.Mandarin)],
    };

    private static string SaveToTemp(SongBank bank)
    {
        var path = Path.Combine(Path.GetTempPath(), $"bank-{Guid.NewGuid():n}.js");
        bank.Save(path);
        return path;
    }

    /// <summary>把檔案裡那塊資料挖出來（去掉外面那圈展開用的 JS）。</summary>
    private static JsonElement DataBlock(string text, out JsonDocument document)
    {
        const string head = "(function(){var b=";
        var start = text.IndexOf(head, StringComparison.Ordinal);
        Assert.True(start >= 0, "找不到資料區塊的開頭");

        var from = start + head.Length;
        var to = text.IndexOf(";function u(", from, StringComparison.Ordinal);
        Assert.True(to > from, "找不到資料區塊的結尾");

        document = JsonDocument.Parse(text[from..to]);
        return document.RootElement;
    }

    [Fact]
    public void 產出的是一行自足的JS()
    {
        // 這一行的形狀就是 file:// 能玩的原因：<script src> 不受同源限制，
        // 換成 JSON 加 fetch 就會在雙擊開啟時被 CORS 擋死。
        //
        // 「自足」的意思是：網頁端只要 <script src> 進來，window.SONG_BANK
        // 就已經是最終形狀，不需要另外一支腳本幫它展開。
        var path = SaveToTemp(Sample());

        try
        {
            var text = File.ReadAllText(path);

            Assert.StartsWith("(function(){", text);
            Assert.Contains("window.SONG_BANK=", text);
            Assert.EndsWith("})();\n", text);
            Assert.Single(text.TrimEnd('\n').Split('\n'));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void 資料存成陣列而不是每首歌都重複一次鍵名()
    {
        // 題庫是每個玩家一進站就要下載的東西。物件形式會把五個鍵名
        // 在每一首歌重複一次，兩千首就是快 100 KB 的純鍵名。
        var path = SaveToTemp(Sample());

        try
        {
            var root = DataBlock(File.ReadAllText(path), out var document);
            using (document)
            {
                var track = root.GetProperty("tracks")[0];
                Assert.Equal(JsonValueKind.Array, track.ValueKind);
                Assert.Equal(5, track.GetArrayLength());

                Assert.Equal(1, track[0].GetInt64());
                Assert.Equal("晴天", track[1].GetString());
                Assert.Equal("周杰倫", track[2].GetString());
                Assert.Equal(0, track[3].GetInt32());          // mandarin 的索引
                Assert.Equal(Middle, track[4].GetString());    // 前後綴被砍掉了

                var decoy = root.GetProperty("decoys")[0];
                Assert.Equal(3, decoy.GetArrayLength());
                Assert.Equal("稻香", decoy[0].GetString());
            }
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void 語種索引對得回網頁端認得的camelCase名稱()
    {
        var path = SaveToTemp(Sample());

        try
        {
            var root = DataBlock(File.ReadAllText(path), out var document);
            using (document)
            {
                var names = root.GetProperty("languages")
                    .EnumerateArray()
                    .Select(x => x.GetString())
                    .ToList();

                Assert.Equal("mandarin", names[0]);
                Assert.Equal("taiwanese", names[1]);

                // 索引表放「所有分得出來的語種」，不是只有寫進題庫的那幾個——
                // 之後開放粵語時，既有語種的索引不能跟著位移，
                // 否則舊題庫檔配新程式會整批認錯語種。
                Assert.Contains("cantonese", names);

                var tracks = root.GetProperty("tracks");
                Assert.Equal(0, tracks[0][3].GetInt32());
                Assert.Equal(1, tracks[1][3].GetInt32());
            }
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void 網址縮短是可逆的而且形狀不合的原樣留著()
    {
        var path = SaveToTemp(Sample());

        try
        {
            var text = File.ReadAllText(path);
            var root = DataBlock(text, out var document);

            using (document)
            {
                var prefix = root.GetProperty("urlPrefix").GetString()!;
                var suffix = root.GetProperty("urlSuffix").GetString()!;
                var tracks = root.GetProperty("tracks");

                // 合乎形狀的：拼回去要和原本一模一樣。
                var shortened = tracks[0][4].GetString()!;
                Assert.False(shortened.StartsWith("http", StringComparison.Ordinal));
                Assert.Equal(RealPrefix + Middle + RealSuffix, prefix + shortened + suffix);

                // 不合形狀的：原樣留著，展開時靠開頭那個 h 分辨。
                var kept = tracks[1][4].GetString()!;
                Assert.StartsWith("https://", kept);
            }

            // 展開用的那一行必須存在，否則網頁拿到的會是原始陣列。
            Assert.Contains("charCodeAt(0)===104", text);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void 中文用UTF8存不逃逸成反斜線u()
    {
        // 這一條和舊版相反，是刻意的。
        //
        // 舊版堅持全 ASCII（中文寫成 \uXXXX），理由是「不管誰用什麼編碼開都不會壞」。
        // 但一個中文字要 6 bytes，UTF-8 只要 3，而整份題庫幾乎都是中文。
        // 檔案是用 <script src> 載入的外部檔，瀏覽器依 HTTP 的 charset 或
        // 檔案本身的 UTF-8 判讀，不會因為有中文就壞掉——那個保險買得太貴了。
        var path = SaveToTemp(Sample());

        try
        {
            var bytes = File.ReadAllBytes(path);
            var text = Encoding.UTF8.GetString(bytes);

            Assert.Contains("晴天", text);
            Assert.DoesNotContain("\\u6674", text);

            // 不能有 BOM：BOM 跑進 <script> 在某些舊瀏覽器會造成語法錯誤。
            Assert.False(bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF,
                "檔案開頭有 BOM");
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void 算出來的Label不進檔案()
    {
        // Label 是「歌名 — 歌手」，網頁端自己會拼。輸出它只是讓檔案變大。
        var path = SaveToTemp(Sample());

        try
        {
            Assert.DoesNotContain("label", File.ReadAllText(path), StringComparison.OrdinalIgnoreCase);
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
    public void 題庫的語種清單和網頁端的一致()
    {
        // 這是整個專案唯一一條跨語言的契約測試。
        //
        // Languages.InBank（C#，決定題庫檔裡有哪些語種）和 rules.js 的 LANGUAGES
        // （JavaScript，決定遊戲裡玩得到哪些語種）必須一樣。不一樣的後果：
        //   * C# 有、JS 沒有：每個玩家白下載一整個語種的歌
        //   * JS 有、C# 沒有：首頁多一顆膠囊，選了卻開不了場
        //
        // 粵語就是踩在這條線上的例子——分類、管道、名稱都備好了，
        // 兩邊同時打開才會生效，這條測試保證不會只開一邊。
        var rules = File.ReadAllText(FindRepoFile(Path.Combine("web", "js", "rules.js")));

        var start = rules.IndexOf("var LANGUAGES = [", StringComparison.Ordinal);
        Assert.True(start >= 0, "rules.js 裡找不到 LANGUAGES");

        var end = rules.IndexOf("];", start, StringComparison.Ordinal);
        var body = rules[(start + "var LANGUAGES = [".Length)..end];

        var fromJs = body
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => x.Trim('\'', '"'))
            .Where(x => x.Length > 0)
            .ToList();

        var fromCs = Languages.InBank
            .Select(x => JsonNamingPolicy.CamelCase.ConvertName(x.ToString()))
            .ToList();

        Assert.Equal(fromCs, fromJs);
    }

    /// <summary>從測試的執行目錄往上找到專案根目錄底下的某個檔。</summary>
    private static string FindRepoFile(string relative)
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "SongQuiz.sln")))
            dir = Path.GetDirectoryName(dir);

        Assert.NotNull(dir);
        var path = Path.Combine(dir!, relative);
        Assert.True(File.Exists(path), $"找不到 {path}");
        return path;
    }
}
