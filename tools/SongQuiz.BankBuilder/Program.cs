using SongQuiz.BankBuilder;
using SongQuiz.Quiz;

// 用法：
//   dotnet run --project tools/SongQuiz.BankBuilder -- [--out 路徑] [--per-artist 8] [--decoys 12]
//                                                     [--country TW] [--delay 400]
//
// 產物是一份 bank.json：可出題的歌 + 只當錯誤選項的誘餌。
// 音檔本身不下載也不轉存——題庫裡放的是 Apple 官方試聽的網址。

// 主控台輸出中文：Windows 預設 cp950，不換成 UTF-8 會變亂碼。
Console.OutputEncoding = System.Text.Encoding.UTF8;

var options = CommandLine.Parse(args);
Console.WriteLine($"題庫輸出：{options.Output}");
Console.WriteLine($"每位演出者取 {options.PerArtist} 首入題庫、{options.Decoys} 首當誘餌；"
                  + $"地區 {options.Country}，間隔 {options.Delay.TotalMilliseconds:0} 毫秒\n");

using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
http.DefaultRequestHeaders.UserAgent.ParseAdd("SongQuiz-BankBuilder/1.0 (personal project; song bank build)");

var client = new ItunesClient(http, options.Country, options.Delay);
var tracks = new List<Track>();
var decoys = new List<Decoy>();
var seenTitles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
var seenIds = new HashSet<long>();

foreach (var (language, artists) in Artists.ByLanguage)
{
    Console.WriteLine($"── {Names.Of(language)} ──");

    foreach (var artist in artists)
    {
        var found = await client.SearchAsync(artist, options.PerArtist + options.Decoys + 10, default);

        var usable = found
            .Where(t => t.Kind == "song")
            .Where(t => t.TrackId != 0 && !string.IsNullOrWhiteSpace(t.TrackName))
            .Where(t => !string.IsNullOrWhiteSpace(t.ArtistName))
            .Select(t => new
            {
                t.TrackId,
                Title = TitleCleaner.Clean(t.TrackName!),
                Artist = t.ArtistName!,
                t.PreviewUrl,
            })
            // 同一首歌會以單曲／專輯／精選重複出現，用「歌名＋演出者」去重。
            .Where(t => seenIds.Add(t.TrackId))
            .Where(t => seenTitles.Add($"{t.Title}|{t.Artist}"))
            .ToList();

        // 有試聽網址的才能出題；沒有的降級成誘餌，歌名照樣有干擾力。
        var playable = usable.Where(t => !string.IsNullOrWhiteSpace(t.PreviewUrl)).ToList();

        var picked = playable.Take(options.PerArtist).ToList();
        tracks.AddRange(picked.Select(t =>
            new Track(t.TrackId, t.Title, t.Artist, language, t.PreviewUrl!)));

        var leftovers = usable.Except(picked).Take(options.Decoys).ToList();
        decoys.AddRange(leftovers.Select(t => new Decoy(t.Title, t.Artist, language)));

        Console.WriteLine($"  {artist}：題庫 +{picked.Count}、誘餌 +{leftovers.Count}");
    }

    Console.WriteLine();
}

var bank = new SongBank { Tracks = tracks, Decoys = decoys };
bank.Save(options.Output);

Console.WriteLine($"完成：{tracks.Count} 首可出題、{decoys.Count} 個誘餌");
foreach (var (language, count) in bank.Census().OrderByDescending(kv => kv.Value))
    Console.WriteLine($"  {Names.Of(language)}：{count} 首");

if (tracks.Count < 90)
    Console.WriteLine("\n（提醒：可出題的歌少於 90 首，闖關模式六關會不夠用。"
                      + "把 Artists.cs 的名單加長，或把 --per-artist 調大。）");

/// <summary>語種的中文名。只有這支工具的輸出用得到。</summary>
internal static class Names
{
    public static string Of(Language language) => language switch
    {
        Language.Mandarin => "華語",
        Language.Taiwanese => "台語",
        Language.Western => "西洋",
        Language.Korean => "韓語",
        Language.Japanese => "日語",
        _ => language.ToString(),
    };
}

/// <summary>命令列參數。</summary>
internal sealed record BuilderOptions(
    string Output,
    int PerArtist,
    int Decoys,
    string Country,
    TimeSpan Delay);

internal static class CommandLine
{
    public static BuilderOptions Parse(string[] args)
    {
        var output = DefaultOutput();
        var perArtist = 8;
        var decoys = 12;
        var country = "TW";
        var delay = TimeSpan.FromMilliseconds(400);

        for (var i = 0; i < args.Length - 1; i += 2)
        {
            var value = args[i + 1];
            switch (args[i])
            {
                case "--out": output = Path.GetFullPath(value); break;
                case "--per-artist": perArtist = int.Parse(value); break;
                case "--decoys": decoys = int.Parse(value); break;
                case "--country": country = value; break;
                case "--delay": delay = TimeSpan.FromMilliseconds(double.Parse(value)); break;
            }
        }

        return new BuilderOptions(output, perArtist, decoys, country, delay);
    }

    /// <summary>預設寫到伺服器讀的位置，讓「跑完就能玩」成立。</summary>
    private static string DefaultOutput()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "SongQuiz.sln")))
            dir = Path.GetDirectoryName(dir);

        dir ??= Directory.GetCurrentDirectory();
        return Path.Combine(dir, "src", "SongQuiz.Server", "data", "bank.json");
    }
}
