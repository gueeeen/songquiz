using System.Text.Json;

namespace SongQuiz.BankBuilder;

/// <summary>
/// 一條「取回管道」：從 Apple 的某一份排行榜拿演出者名單。
/// </summary>
/// <remarks>
/// 為什麼要有這層：原本的名單是手打的（Artists.cs），問題不是不能用，
/// 是**它不會自己更新**，而且「誰紅」是我猜的。榜單是真的播放排行，
/// 每個月重撈就會自動換人。
///
/// 為什麼只拿演出者、不直接拿榜上的歌：榜單一份上限 100 首，
/// 拿去當題庫太少；但那 100 首指到的 50～70 位演出者，
/// 再用 Search API 各撈十幾首，就有幾百首了。
/// （順帶一提，榜單的每一筆其實**也附了試聽網址**，要直接收進題庫是可行的，
/// 只是那會變成「只出榜上那幾首」，題目會太集中。留著當之後的選項。）
/// </remarks>
/// <param name="Storefront">Apple 的地區代碼，例如 tw、jp、us。</param>
/// <param name="Genre">曲風 id。null 表示不分曲風的總榜。</param>
/// <param name="Language">這條管道撈到的人，算哪一個語種。</param>
/// <param name="Note">印在畫面上的說明。</param>
public sealed record ChartChannel(string Storefront, int? Genre, Language Language, string Note);

public static class Charts
{
    /// <summary>
    /// 所有取回管道。
    /// </summary>
    /// <remarks>
    /// 幾個決定：
    ///
    /// **粵語（1251）是自己的語種，不併進華語。** 併進去的話華語場會冒出粵語歌，
    /// 那是錯的——玩家選「華語」就是要聽華語。
    /// 它目前不寫進題庫檔（見 Languages.InBank），但管道、分類、名稱都已經備好，
    /// 要開放時改一行就行。
    ///
    /// **韓語用三個商店的 K-Pop 榜聯集。**
    /// 曲風 id 是 51，不是 1252——踩過一次：1252 叫「韓國流行」，聽起來很對，
    /// 但它撈到的全是獨立與抒情的長尾（Mingginyu、Nahee、Scenery Of Riding Bicycle…），
    /// 六個商店試過都一樣，沒有任何一個大團。51 才是 K-Pop 主榜：
    /// BTS、BLACKPINK、TWICE、IU、NewJeans、SEVENTEEN、Stray Kids、aespa 都在裡面。
    ///
    /// 為什麼要三個商店：一個榜只有四十幾位，而且各地聽的不完全一樣——
    /// 台灣榜有 IU 和 ATEEZ、美國榜有 ROSÉ & Bruno Mars、日本榜有 Stray Kids。
    /// 三家聯集是 95 位，那就是「全球韓文歌」最接近的東西（Apple 沒有全球榜）。
    /// 台灣排最前面：玩的人在台灣，這裡紅的對他們最好認，而名次就是難度。
    ///
    /// 1252 留在最後面當深度補充。它的歌手是真的，只是小眾——排在後面表示
    /// Fame 比較差，難度分級會自動把它們放進中等與困難那兩級。
    ///
    /// 韓國商店（kr）的 RSS 不管哪個曲風都是空的，所以沒有它。
    ///
    /// **日語台灣榜排在日本榜前面。** 日本本地榜是傑尼斯與偶像團
    /// （なにわ男子、M!LK、Aぇ! group），台灣人多半不認得；台灣的 J-Pop 榜
    /// 是宇多田光、米津玄師、SixTONES——那才是這裡的玩家聽過的。
    /// 日本榜留在後面補深度。
    ///
    /// **西洋用 Pop 曲風榜，不用總榜。** 美國總榜有一大半是鄉村
    /// （Ella Langley、Dolly Parton、Chad Prather），那些在台灣幾乎沒人認得。
    /// us/14 與 gb/14 兩個 Pop 榜給的是 Miley Cyrus、Olivia Rodrigo、
    /// Dua Lipa、Shakira 這種跨市場的。
    /// 代價是會漏掉嘻哈——那是刻意的取捨，這個遊戲要的是「認得出來」。
    /// </remarks>
    public static readonly ChartChannel[] All =
    [
        new("tw", 1253, Language.Mandarin, "台灣・華語流行樂"),
        new("tw", 1251, Language.Cantonese, "台灣・粵語流行"),
        new("tw", 1254, Language.Taiwanese, "台灣・台灣流行樂"),
        new("tw", 51, Language.Korean, "台灣・K-Pop"),
        new("us", 51, Language.Korean, "美國・K-Pop"),
        new("jp", 51, Language.Korean, "日本・K-Pop"),
        new("tw", 1252, Language.Korean, "台灣・韓國流行（補深度，多半是獨立與抒情）"),
        new("tw", 27, Language.Japanese, "台灣・J-Pop"),
        new("jp", 27, Language.Japanese, "日本・J-Pop（補深度）"),
        new("us", 14, Language.Western, "美國・Pop"),
        new("gb", 14, Language.Western, "英國・Pop"),
    ];

    /// <summary>
    /// 榜單的網址。
    /// </summary>
    /// <remarks>
    /// 用舊的 itunes.apple.com/rss，不是 rss.applemarketingtools.com——
    /// 後者實測會 301 轉址而且轉過去拿不到東西，前者現在還活著而且是 JSON。
    /// 這是外部服務，哪天不動了要能一眼看出來，所以拿到 0 筆會出聲（見 Program）。
    /// </remarks>
    public static string UrlOf(ChartChannel channel, int limit)
    {
        var genre = channel.Genre is null ? "" : $"genre={channel.Genre}/";
        return $"https://itunes.apple.com/{channel.Storefront}/rss/topsongs/limit={limit}/{genre}json";
    }
}


/// <summary>榜單上的一首歌。名次就是它的知名度訊號。</summary>
/// <param name="Rank">在這條管道裡排第幾（從 0 開始）。</param>
public sealed record ChartSong(
    int Rank,
    long Id,
    string Title,
    string Artist,
    string PreviewUrl,
    string? Genre);
/// <summary>排行榜用戶端。只讀一份 JSON，把上面的演出者依名次取出來。</summary>
public sealed class ChartClient(HttpClient http)
{
    /// <summary>
    /// 依名次回傳不重複的演出者。名次有意義——愈前面愈紅，
    /// 而題庫有上限，所以先撈前面的人。
    /// </summary>
    public async Task<IReadOnlyList<string>> ArtistsAsync(ChartChannel channel, int limit, CancellationToken token)
    {
        var url = Charts.UrlOf(channel, limit);

        try
        {
            using var stream = await http.GetStreamAsync(url, token);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: token);

            if (!document.RootElement.TryGetProperty("feed", out var feed) ||
                !feed.TryGetProperty("entry", out var entries) ||
                entries.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            var artists = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var entry in entries.EnumerateArray())
            {
                if (!entry.TryGetProperty("im:artist", out var artist) ||
                    !artist.TryGetProperty("label", out var label))
                {
                    continue;
                }

                var name = label.GetString();
                if (string.IsNullOrWhiteSpace(name)) continue;
                if (seen.Add(name)) artists.Add(name);
            }

            return artists;
        }
        catch (Exception error) when (error is HttpRequestException or JsonException or TaskCanceledException)
        {
            // 一條管道壞掉不該讓整份題庫建不起來——少一條就少一條，
            // 但要講出來，否則會安靜地產出一份缺一個語種的題庫。
            Console.WriteLine($"  · 榜單讀不到（{channel.Note}）：{error.Message}");
            return [];
        }
    }

    /// <summary>
    /// 榜上的歌本身，依名次。
    /// </summary>
    /// <remarks>
    /// 一開始只拿演出者、不拿歌，理由是「一份榜只有 100 首，當題庫太少」。
    /// 那個理由對，但漏了一件事：**這 100 首是整個題庫裡唯一有真實名次的歌**。
    /// 拿它們當「簡單」那一級的頭幾十名，題庫每個月就會自動換一批——
    /// 光靠經典歌單的話，簡單那一級是固定的，玩久了就背起來了。
    ///
    /// 每一筆都自帶試聽網址，所以不用再打一次 Search API。
    /// </remarks>
    public async Task<IReadOnlyList<ChartSong>> SongsAsync(ChartChannel channel, int limit, CancellationToken token)
    {
        var url = Charts.UrlOf(channel, limit);

        try
        {
            using var stream = await http.GetStreamAsync(url, token);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: token);

            if (!document.RootElement.TryGetProperty("feed", out var feed) ||
                !feed.TryGetProperty("entry", out var entries) ||
                entries.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            var songs = new List<ChartSong>();
            var rank = 0;

            foreach (var entry in entries.EnumerateArray())
            {
                var title = Text(entry, "im:name");
                var artist = Text(entry, "im:artist");
                var preview = PreviewOf(entry);

                // 沒有試聽網址的出不了題。榜上偶爾會有這種（多半是剛上架的）。
                if (string.IsNullOrWhiteSpace(title) || string.IsNullOrWhiteSpace(artist)
                    || string.IsNullOrWhiteSpace(preview))
                {
                    rank++;
                    continue;
                }

                songs.Add(new ChartSong(rank, IdOf(entry), TitleCleaner.Clean(title), artist, preview!, GenreOf(entry)));
                rank++;
            }

            return songs;
        }
        catch (Exception error) when (error is HttpRequestException or JsonException or TaskCanceledException)
        {
            Console.WriteLine($"  · 榜單讀不到（{channel.Note}）：{error.Message}");
            return [];
        }
    }

    private static string? Text(JsonElement entry, string property) =>
        entry.TryGetProperty(property, out var node) && node.TryGetProperty("label", out var label)
            ? label.GetString()
            : null;

    /// <summary>
    /// 榜單的 id 是字串。解不出來就給 0——那只會讓它在去重時被當成新的一首，
    /// 不會壞掉（歌名＋歌手那一層還會擋）。
    /// </summary>
    private static long IdOf(JsonElement entry) =>
        entry.TryGetProperty("id", out var id)
        && id.TryGetProperty("attributes", out var attributes)
        && attributes.TryGetProperty("im:id", out var value)
        && long.TryParse(value.GetString(), out var parsed)
            ? parsed
            : 0;

    private static string? GenreOf(JsonElement entry) =>
        entry.TryGetProperty("category", out var category)
        && category.TryGetProperty("attributes", out var attributes)
        && attributes.TryGetProperty("term", out var term)
            ? term.GetString()
            : null;

    /// <summary>
    /// 試聽網址。link 可能是陣列也可能是單一物件（只有一個連結的時候），
    /// 兩種都要接——只處理陣列的話，偶爾會整筆拿不到網址。
    /// </summary>
    private static string? PreviewOf(JsonElement entry)
    {
        if (!entry.TryGetProperty("link", out var link)) return null;

        if (link.ValueKind == JsonValueKind.Array)
        {
            foreach (var one in link.EnumerateArray())
            {
                var href = AudioHref(one);
                if (href is not null) return href;
            }

            return null;
        }

        return AudioHref(link);
    }

    private static string? AudioHref(JsonElement link) =>
        link.TryGetProperty("attributes", out var attributes)
        && attributes.TryGetProperty("type", out var type)
        && type.GetString() == "audio/x-m4a"
        && attributes.TryGetProperty("href", out var href)
            ? href.GetString()
            : null;
}
