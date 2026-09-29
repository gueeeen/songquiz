using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace SongQuiz.BankBuilder;

/// <summary>
/// Apple 的公開 Search API 用戶端。
/// </summary>
/// <remarks>
/// 這支工具是「偶爾跑一次、產生一份題庫檔」，不是線上服務的一部分。
/// 所以它一律循序送請求、每次之間睡一下，並且遇到 429／403 就退讓重試。
/// 對方沒有義務招待我們，禮貌是預設值而不是選項。
/// </remarks>
public sealed class ItunesClient(HttpClient http, string country, TimeSpan delay)
{
    private DateTimeOffset _nextAllowed = DateTimeOffset.MinValue;

    /// <summary>
    /// 撈某一位演出者的歌，用 artistId。
    /// </summary>
    /// <remarks>
    /// **用 id 而不是用名字搜，是因為名字會拿錯人。**
    /// 搜「LiSA」Apple 先給你小野麗莎（bossa nova），搜「Queen」撈不到 Queen 本人
    /// （一首叫 Queen 的日文歌排在前面），搜「Perfume」是 0 首。
    /// lookup 問的是「這個 id 的歌」，沒有歧義。整段理由在 Artists.cs 開頭。
    /// </remarks>
    public Task<IReadOnlyList<ItunesTrack>> SongsOfArtistAsync(long artistId, int limit, CancellationToken token)
    {
        var url = "https://itunes.apple.com/lookup"
                  + $"?id={artistId}"
                  + $"&country={country}"
                  + "&entity=song"
                  + $"&limit={limit}";

        return GetAsync(url, artistId.ToString(), token);
    }

    /// <summary>用名字搜歌。現在只有解析 artistId 的腳本會用到。</summary>
    public Task<IReadOnlyList<ItunesTrack>> SearchAsync(string artist, int limit, CancellationToken token)
    {
        var url = "https://itunes.apple.com/search"
                  + $"?term={Uri.EscapeDataString(artist)}"
                  + $"&country={country}"
                  + "&media=music&entity=song"
                  + $"&limit={limit}";

        return GetAsync(url, artist, token);
    }

    private async Task<IReadOnlyList<ItunesTrack>> GetAsync(string url, string label, CancellationToken token)
    {
        for (var attempt = 1; attempt <= 4; attempt++)
        {
            await WaitTurnAsync(token);

            try
            {
                var response = await http.GetAsync(url, token);
                if (response.IsSuccessStatusCode)
                {
                    var payload = await response.Content.ReadFromJsonAsync<ItunesResponse>(token);
                    return payload?.Results ?? [];
                }

                if (response.StatusCode is HttpStatusCode.TooManyRequests or HttpStatusCode.Forbidden)
                {
                    var backoff = TimeSpan.FromSeconds(5 * attempt);
                    Console.WriteLine($"  · {response.StatusCode}，等 {backoff.TotalSeconds:0} 秒再試（第 {attempt} 次）");
                    await Task.Delay(backoff, token);
                    continue;
                }

                Console.WriteLine($"  · {label}：{(int)response.StatusCode} {response.ReasonPhrase}，跳過");
                return [];
            }
            catch (Exception error) when (error is HttpRequestException or TaskCanceledException or IOException)
            {
                // 逾時、連線被切、DNS 抽風——這些**不是**程式的錯，而且一定會發生：
                // 這支工具要連續打兩百多次請求、跑十幾分鐘。
                //
                // 原本這裡沒接，結果一次 20 秒逾時就讓整份題庫作廢
                // （實測在第 42 次請求掛掉，前面四十幾次全白做）。
                // 現在退讓重試，連續失敗才跳過這一位——少一位演出者，不是少一份題庫。
                var backoff = TimeSpan.FromSeconds(5 * attempt);
                Console.WriteLine($"  · 連線出問題（{error.GetType().Name}），等 {backoff.TotalSeconds:0} 秒再試（第 {attempt} 次）");
                await Task.Delay(backoff, token);
            }
        }


        Console.WriteLine($"  · {label}：連續失敗，跳過");
        return [];
    }

    /// <summary>兩次請求之間至少隔 <c>delay</c>。</summary>
    private async Task WaitTurnAsync(CancellationToken token)
    {
        var wait = _nextAllowed - DateTimeOffset.UtcNow;
        if (wait > TimeSpan.Zero) await Task.Delay(wait, token);
        _nextAllowed = DateTimeOffset.UtcNow + delay;
    }
}

/// <summary>Search API 的回應外殼。</summary>
public sealed class ItunesResponse
{
    [JsonPropertyName("resultCount")] public int ResultCount { get; set; }
    [JsonPropertyName("results")] public List<ItunesTrack> Results { get; set; } = [];
}

/// <summary>回應裡我們用得到的欄位。</summary>
public sealed class ItunesTrack
{
    [JsonPropertyName("trackId")] public long TrackId { get; set; }
    [JsonPropertyName("trackName")] public string? TrackName { get; set; }
    [JsonPropertyName("artistName")] public string? ArtistName { get; set; }
    [JsonPropertyName("previewUrl")] public string? PreviewUrl { get; set; }
    [JsonPropertyName("kind")] public string? Kind { get; set; }

    /// <summary>
    /// 這首歌自己的曲風。語種靠它判斷——按歌手判的話，雙聲帶歌手
    /// （蕭煌奇同時唱台語和華語）的歌會整批被算成同一種。
    /// </summary>
    [JsonPropertyName("primaryGenreName")] public string? PrimaryGenreName { get; set; }

    /// <summary>
    /// 發行日，像 "2004-08-03T12:00:00Z"。
    /// </summary>
    /// <remarks>
    /// 拿來看年代覆蓋。Apple 的免費端點**沒有年代排行榜**（實測 decade=2000 是
    /// 被靜默忽略的，回傳和當期榜一字不差），所以「各年代都要有歌」只能從這裡看。
    ///
    /// 而且不必另外撈：Search 的排序本來就是按人氣，老歌手的前十幾首就是他的
    /// 代表作，年代覆蓋是順便來的——周杰倫前 50 首裡 28 首是 2000 年代
    /// （擱淺、晴天、七里香、稻香），伍佰前 30 首裡 22 首是 1990 年代。
    ///
    /// 只在產生器裡用，不寫進 bank.js：那個檔每個玩家一進站就要下載，
    /// 沒有人會用到年份的東西之前不該把它塞進去。
    /// </remarks>
    [JsonPropertyName("releaseDate")] public string? ReleaseDate { get; set; }
}
