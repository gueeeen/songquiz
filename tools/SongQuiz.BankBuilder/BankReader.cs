using System.Text.Json;

namespace SongQuiz.BankBuilder;

/// <summary>
/// 把上一次產生的題庫檔讀回來。
/// </summary>
/// <remarks>
/// 這支工具本來只寫不讀，加這一層是為了「每個月換新榜」這件事。
///
/// 每月直接覆蓋會有兩個問題：
///
/// 一、**一條管道壞掉就少一個語種。** 榜單是外部服務，Apple 哪天改網址、
///     或那天剛好連不上，重跑一次就會產出一份缺語種的題庫，而且是靜悄悄的。
///     讀得到上個月的檔，就能拿它補。
/// 二、**題目每個月整批換掉。** 上個月紅、這個月掉榜的歌會全部消失，
///     但那些歌玩家未必忘了。留一部分名額給上個月的，換血會平順很多。
///
/// 解析的是我們自己寫出去的格式，所以只認得那一種形狀——
/// 認不得就當作沒有上一版，不會讓建置失敗（見 TryRead）。
/// </remarks>
public static class BankReader
{
    /// <summary>
    /// 讀舊題庫。檔案不在、格式不認得、內容壞掉，一律回 null——
    /// 合併只是加分，不該變成建置失敗的理由。
    /// </summary>
    public static (List<Track> Tracks, List<Decoy> Decoys)? TryRead(string path)
    {
        if (!File.Exists(path)) return null;

        try
        {
            var text = File.ReadAllText(path);

            // 檔案長這樣：(function(){var b={…};function u(s){…}…})();
            // 我們要的是中間那塊 JSON。
            const string head = "(function(){var b=";
            var start = text.IndexOf(head, StringComparison.Ordinal);
            if (start < 0) return null;

            var from = start + head.Length;
            var to = text.IndexOf(";function u(", from, StringComparison.Ordinal);
            if (to <= from) return null;

            using var document = JsonDocument.Parse(text[from..to]);
            var root = document.RootElement;

            var languages = root.GetProperty("languages")
                .EnumerateArray()
                .Select(x => x.GetString() ?? string.Empty)
                .ToList();

            var prefix = root.GetProperty("urlPrefix").GetString() ?? string.Empty;
            var suffix = root.GetProperty("urlSuffix").GetString() ?? string.Empty;

            var tracks = new List<Track>();
            foreach (var row in root.GetProperty("tracks").EnumerateArray())
            {
                var language = ParseLanguage(languages, row[3].GetInt32());
                if (language is null) continue;

                var url = row[4].GetString() ?? string.Empty;
                if (!url.StartsWith("http", StringComparison.Ordinal)) url = prefix + url + suffix;

                tracks.Add(new Track(
                    row[0].GetInt64(),
                    row[1].GetString() ?? string.Empty,
                    row[2].GetString() ?? string.Empty,
                    language.Value,
                    url));
            }

            var decoys = new List<Decoy>();
            foreach (var row in root.GetProperty("decoys").EnumerateArray())
            {
                var language = ParseLanguage(languages, row[2].GetInt32());
                if (language is null) continue;

                decoys.Add(new Decoy(
                    row[0].GetString() ?? string.Empty,
                    row[1].GetString() ?? string.Empty,
                    language.Value));
            }

            return (tracks, decoys);
        }
        catch (Exception error) when (error is JsonException or IOException or IndexOutOfRangeException)
        {
            Console.WriteLine($"  · 讀不懂上一版題庫（{error.GetType().Name}），這次當成全新建。");
            return null;
        }
    }

    /// <summary>
    /// 索引換回語種。
    /// </summary>
    /// <remarks>
    /// 認不得的索引就丟掉那一筆，而不是猜一個。
    /// 舊檔案的索引表如果比現在短（那時候還沒有粵語），前面幾個仍然對得上——
    /// 索引表刻意放「所有分得出來的語種」就是為了這件事（見 SongBank.Save）。
    /// </remarks>
    private static Language? ParseLanguage(List<string> names, int index)
    {
        if (index < 0 || index >= names.Count) return null;
        return Enum.TryParse<Language>(names[index], ignoreCase: true, out var language) ? language : null;
    }
}
