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
    /// **韓語有兩條管道。** 韓國商店（kr）的 RSS 實測是空的，
    /// 所以只剩台灣商店的韓國流行榜（56 位），比其他語種少。
    /// 不夠的部分靠 Artists.cs 那份手打名單補——那正是它現在的用途。
    ///
    /// **西洋用美國總榜。** 曲風榜（us/14 Pop）會漏掉嘻哈與鄉村，
    /// 而那兩類在美國榜上占比不低。
    /// </remarks>
    public static readonly ChartChannel[] All =
    [
        new("tw", 1253, Language.Mandarin, "台灣・華語流行樂"),
        new("tw", 1251, Language.Cantonese, "台灣・粵語流行"),
        new("tw", 1254, Language.Taiwanese, "台灣・台灣流行樂"),
        new("tw", 1252, Language.Korean, "台灣・韓國流行"),
        new("jp", 27, Language.Japanese, "日本・J-Pop"),
        new("us", null, Language.Western, "美國・總榜"),
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
}
