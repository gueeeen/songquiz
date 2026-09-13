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

    /// <summary>查一位演出者的歌。</summary>
    public async Task<IReadOnlyList<ItunesTrack>> SearchAsync(string artist, int limit, CancellationToken token)
    {
        var url = "https://itunes.apple.com/search"
                  + $"?term={Uri.EscapeDataString(artist)}"
                  + $"&country={country}"
                  + "&media=music&entity=song"
                  + $"&limit={limit}";

        for (var attempt = 1; attempt <= 3; attempt++)
        {
            await WaitTurnAsync(token);

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

            Console.WriteLine($"  · {artist}：{(int)response.StatusCode} {response.ReasonPhrase}，跳過");
            return [];
        }

        Console.WriteLine($"  · {artist}：連續失敗，跳過");
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
}
