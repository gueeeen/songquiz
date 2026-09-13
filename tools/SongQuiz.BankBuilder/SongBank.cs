using System.Text.Json;
using System.Text.Json.Serialization;

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

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        WriteIndented = false,
    };

    /// <summary>
    /// 寫題庫檔。
    /// </summary>
    /// <remarks>
    /// 為什麼寫成 .js 而不是 .json：這個站要能雙擊 index.html 直接玩，
    /// 而 file:// 下 fetch('data/bank.json') 會被 CORS 當成跨來源請求擋掉
    /// （file:// 的來源是 null，沒有伺服器可以回 Access-Control-Allow-Origin）。
    /// 改成 &lt;script src="data/bank.js"&gt; 就沒有這回事——script 標籤不受同源限制，
    /// 代價只是題庫要掛在一個全域變數上。
    /// </remarks>
    public void Save(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var file = new BankFile
        {
            GeneratedAt = DateTimeOffset.UtcNow,
            Tracks = [.. Tracks],
            Decoys = [.. Decoys],
        };

        // 一行搞定：這是機器產生、給瀏覽器讀的檔，沒有人要 diff 它或用眼睛讀它。
        File.WriteAllText(path, $"window.SONG_BANK={JsonSerializer.Serialize(file, JsonOptions)};\n");
    }

    private sealed class BankFile
    {
        public DateTimeOffset GeneratedAt { get; set; }
        public List<Track> Tracks { get; set; } = [];
        public List<Decoy> Decoys { get; set; } = [];
    }
}
