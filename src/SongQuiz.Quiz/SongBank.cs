using System.Text.Json;
using System.Text.Json.Serialization;

namespace SongQuiz.Quiz;

/// <summary>
/// 題庫：可以出題的歌，加上只當錯誤選項的誘餌。
/// 整份由 tools/SongQuiz.BankBuilder 產生成一個 bank.json，啟動時讀進記憶體。
/// </summary>
public sealed class SongBank
{
    public required IReadOnlyList<Track> Tracks { get; init; }
    public required IReadOnlyList<Decoy> Decoys { get; init; }

    /// <summary>題庫是空的時候，前端要能講出原因而不是丟一個白畫面。</summary>
    public bool IsEmpty => Tracks.Count == 0;

    public static SongBank Empty { get; } = new() { Tracks = [], Decoys = [] };

    /// <summary>某幾個語種底下有幾首可出題的歌。</summary>
    public int CountOf(IReadOnlyCollection<Language> languages) =>
        Tracks.Count(t => languages.Contains(t.Language));

    /// <summary>每個語種各有幾首，給設定頁與 /api/bank 用。</summary>
    public IReadOnlyDictionary<Language, int> Census() =>
        Tracks.GroupBy(t => t.Language).ToDictionary(g => g.Key, g => g.Count());

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        WriteIndented = false,
    };

    /// <summary>讀題庫檔。檔案不存在就回空題庫——這不是錯誤，是「還沒建題庫」。</summary>
    public static SongBank LoadOrEmpty(string path)
    {
        if (!File.Exists(path)) return Empty;

        var raw = JsonSerializer.Deserialize<BankFile>(File.ReadAllText(path), JsonOptions);
        if (raw is null) return Empty;

        return new SongBank
        {
            Tracks = raw.Tracks
                .Where(t => !string.IsNullOrWhiteSpace(t.PreviewUrl))
                .ToList(),
            Decoys = raw.Decoys,
        };
    }

    /// <summary>寫題庫檔。只有 BankBuilder 會呼叫。</summary>
    public void Save(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var file = new BankFile
        {
            GeneratedAt = DateTimeOffset.UtcNow,
            Tracks = [.. Tracks],
            Decoys = [.. Decoys],
        };
        File.WriteAllText(path, JsonSerializer.Serialize(file, JsonOptions));
    }

    private sealed class BankFile
    {
        public DateTimeOffset GeneratedAt { get; set; }
        public List<Track> Tracks { get; set; } = [];
        public List<Decoy> Decoys { get; set; } = [];
    }
}
