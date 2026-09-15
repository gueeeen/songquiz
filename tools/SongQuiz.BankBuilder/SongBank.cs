using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Unicode;

namespace SongQuiz.BankBuilder;

/// <summary>
/// 題庫：可以出題的歌，加上只當錯誤選項的誘餌。
/// 這支工具負責產生它，網頁端讀它出題——所以這裡只有寫，沒有讀。
/// </summary>
public sealed class SongBank
{
    public required IReadOnlyList<Track> Tracks { get; init; }
    public required IReadOnlyList<Decoy> Decoys { get; init; }

    /// <summary>每個語種各有幾首，跑完印出來讓人確認分佈沒歪掉。</summary>
    public IReadOnlyDictionary<Language, int> Census() =>
        Tracks.GroupBy(t => t.Language).ToDictionary(g => g.Key, g => g.Count());

    /// <summary>
    /// 試聽網址的共同前後綴。Apple 的試聽全部長這樣，每首歌重複一次是純粹的浪費。
    /// </summary>
    private const string UrlPrefix = "https://audio-ssl.itunes.apple.com/itunes-assets/";
    private const string UrlSuffix = ".plus.aac.p.m4a";

    /// <summary>
    /// 不要把中文逃逸成 \uXXXX。
    /// </summary>
    /// <remarks>
    /// 預設的編碼器很保守，會把所有非 ASCII 寫成 \uXXXX——一個中文字 6 bytes，
    /// 而 UTF-8 只要 3。整份題庫幾乎都是中文歌名與歌手名，這一項就差一倍。
    /// 檔案是用 &lt;script src&gt; 載入的外部檔，不是內嵌在 HTML 裡，
    /// 所以放寬逃逸不會有「資料裡出現 &lt;/script&gt; 就跳出去」那類問題。
    /// </remarks>
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
        WriteIndented = false,
    };

    /// <summary>
    /// 寫題庫檔。
    /// </summary>
    /// <remarks>
    /// **為什麼寫成 .js 而不是 .json**：這個站要能雙擊 index.html 直接玩，
    /// 而 file:// 下 fetch('data/bank.json') 會被 CORS 當成跨來源請求擋掉
    /// （file:// 的來源是 null，沒有伺服器可以回 Access-Control-Allow-Origin）。
    /// 改成 &lt;script src="data/bank.js"&gt; 就沒有這回事。
    ///
    /// **為什麼存成陣列再展開**：題庫是每個玩家一進站就要下載的東西，而現場多半
    /// 是手機網路。物件形式的 JSON 會把 "id"/"title"/"artist"/"language"/"previewUrl"
    /// 這五個鍵在每一首歌重複一次（約 48 bytes），兩千首就是 96 KB 的鍵名；
    /// 網址的共同前後綴又是每首 75 bytes。改成陣列＋展開之後這些都只出現一次。
    ///
    /// 展開出來的 window.SONG_BANK 形狀和以前**完全一樣**，所以網頁那邊
    /// 一行都不用改——這是刻意的，格式是實作細節，不該漏到遊戲邏輯裡。
    /// </remarks>
    public void Save(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        // 語種存成索引。"mandarin" 一個字串在檔案裡是 12 bytes，索引是 1。
        // 索引表放「所有分得出來的語種」，不是只有寫進題庫的那幾個：
        // 這樣之後開放粵語時，既有語種的索引不會跟著位移。
        var languages = Enum.GetValues<Language>();
        var languageIndex = languages
            .Select((language, index) => (language, index))
            .ToDictionary(pair => pair.language, pair => pair.index);

        var languageNames = languages
            .Select(language => JsonNamingPolicy.CamelCase.ConvertName(language.ToString()))
            .ToArray();

        var trackRows = Tracks
            .Select(track => new object[]
            {
                track.Id,
                track.Title,
                track.Artist,
                languageIndex[track.Language],
                Shorten(track.PreviewUrl),
            })
            .ToList();

        var decoyRows = Decoys
            .Select(decoy => new object[]
            {
                decoy.Title,
                decoy.Artist,
                languageIndex[decoy.Language],
            })
            .ToList();

        var json = new
        {
            generatedAt = DateTimeOffset.UtcNow,
            languages = languageNames,
            urlPrefix = UrlPrefix,
            urlSuffix = UrlSuffix,
            tracks = trackRows,
            decoys = decoyRows,
        };

        // 展開的那幾行跟著資料一起寫出來，題庫檔就是自足的：
        // 網頁端只要 <script src> 進來，window.SONG_BANK 就已經是最終形狀。
        var text = "(function(){var b=" + JsonSerializer.Serialize(json, JsonOptions) + ";"
                   + "function u(s){return s.charCodeAt(0)===104?s:b.urlPrefix+s+b.urlSuffix;}"
                   + "window.SONG_BANK={generatedAt:b.generatedAt,"
                   + "tracks:b.tracks.map(function(r){"
                   + "return {id:r[0],title:r[1],artist:r[2],language:b.languages[r[3]],previewUrl:u(r[4])};}),"
                   + "decoys:b.decoys.map(function(r){"
                   + "return {title:r[0],artist:r[1],language:b.languages[r[2]]};})};})();\n";

        File.WriteAllText(path, text, new System.Text.UTF8Encoding(false));
    }

    /// <summary>
    /// 砍掉試聽網址的共同前後綴。
    /// 形狀不合的（Apple 哪天換了 CDN）就原樣留著，展開時看第一個字是不是 h 來分辨。
    /// </summary>
    private static string Shorten(string url)
    {
        if (!url.StartsWith(UrlPrefix, StringComparison.Ordinal)) return url;
        if (!url.EndsWith(UrlSuffix, StringComparison.Ordinal)) return url;

        return url[UrlPrefix.Length..^UrlSuffix.Length];
    }
}
