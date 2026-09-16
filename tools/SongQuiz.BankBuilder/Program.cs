using SongQuiz.BankBuilder;

// 用法：跑「重建題庫.cmd」。要帶參數就接在後面：
//   重建題庫.cmd [--out 路徑] [--per-artist 15] [--tracks 450] [--decoys 500]
//                [--country TW] [--delay 800] [--chart-limit 100]
//
// 不要用 dotnet run——這台機器的 Smart App Control 會擋剛編出來、還沒有信譽的
// 執行檔（「存取被拒」）。腳本改請已簽章的 dotnet 主機載入 DLL，比較不容易被擋。
//
// ── 題庫怎麼來的 ──────────────────────────────────────────────
//
// 兩段式：
//
//   一、**誰**：從 Apple 的排行榜拿演出者（Charts.cs）。那是真的播放排行，
//       每個月重撈就會自動換人。榜單本身一份上限 100 首，拿來當題庫太少，
//       但它指到的 50～70 位演出者是可靠的入口。
//       名單後面再接上手打的備源（Artists.cs），補榜單撈不滿的語種與經典曲。
//
//   二、**哪些歌**：對每位演出者用 Search API 撈他的歌（舊方法沒有變），
//       有試聽網址的收進題庫，其餘降級成誘餌——歌名照樣有干擾力。
//
// 收到語種的上限就停：不是撈愈多愈好，題庫是每個玩家一進站就要下載的東西。
//
// 產物是一份 bank.js，掛在 window.SONG_BANK 上（為什麼是 .js 見 SongBank.Save）。
// 音檔本身不下載也不轉存——題庫裡放的是 Apple 官方試聽的網址。

// 主控台輸出中文：Windows 預設 cp950，不換成 UTF-8 會變亂碼。
Console.OutputEncoding = System.Text.Encoding.UTF8;

var options = CommandLine.Parse(args);
Console.WriteLine($"題庫輸出：{options.Output}");
Console.WriteLine($"每位演出者取 {options.PerArtist} 首入題庫；"
                  + $"每個語種上限 {options.TracksPerLanguage} 首、誘餌 {options.DecoysPerLanguage} 個");
Console.WriteLine($"地區 {options.Country}，間隔 {options.Delay.TotalMilliseconds:0} 毫秒\n");

// 30 秒而不是 20：Apple 偶爾會慢，而逾時的代價是重試（等更久），不是失敗。
using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
http.DefaultRequestHeaders.UserAgent.ParseAdd("SongQuiz-BankBuilder/2.0 (personal project; song bank build)");

var charts = new ChartClient(http);
var client = new ItunesClient(http, options.Country, options.Delay);

// ── 第一段：湊出每個語種的演出者名單 ──────────────────────────

Console.WriteLine("── 排行榜 ──");

var roster = new Dictionary<Language, List<string>>();
var inRoster = new Dictionary<Language, HashSet<string>>();

foreach (var language in Languages.InBank)
{
    roster[language] = [];
    inRoster[language] = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
}

foreach (var channel in Charts.All)
{
    // 不會寫進題庫的語種，連榜都不用去讀——省一次請求，也省得之後要丟掉。
    if (!Languages.IsInBank(channel.Language))
    {
        Console.WriteLine($"  {channel.Note}：跳過（{Names.Of(channel.Language)}還沒開放，見 Languages.cs）");
        continue;
    }

    var artists = await charts.ArtistsAsync(channel, options.ChartLimit, default);


    var added = 0;
    foreach (var artist in artists)
    {
        if (inRoster[channel.Language].Add(artist))
        {
            roster[channel.Language].Add(artist);
            added++;
        }
    }

    Console.WriteLine(artists.Count == 0
        ? $"  {channel.Note}：0 位——這條管道可能壞了，看看網址還通不通"
        : $"  {channel.Note}：{artists.Count} 位，新加入 {added} 位");
}

Console.WriteLine("\n── 備源（手打名單）──");

foreach (var (language, artists) in Artists.ByLanguage)
{
    if (!Languages.IsInBank(language)) continue;

    var added = 0;

    foreach (var artist in artists)
    {
        if (inRoster[language].Add(artist))
        {
            roster[language].Add(artist);
            added++;
        }
    }

    Console.WriteLine($"  {Names.Of(language)}：名單 {artists.Length} 位，新加入 {added} 位"
                      + $"（合計 {roster[language].Count} 位）");
}

// ── 第二段：對每位演出者撈歌 ──────────────────────────────────

// 合併那一段會整份換掉，所以不能是 readonly。
var tracks = new List<Track>();
var decoys = new List<Decoy>();

// 去重跨語種共用：同一首歌被兩個語種的演出者帶出來時，先到先得。
var seenIds = new HashSet<long>();
var seenTitles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

// 一次搜尋要回幾筆。取題庫要的 15 首，加上要拿來當誘餌的，再留一點餘裕給
// 「同一首歌以單曲／專輯／精選重複出現」被去掉的那些。
var searchLimit = options.PerArtist + options.DecoysPerArtist + 15;

var requests = 0;

foreach (var language in Languages.InBank)
{
    Console.WriteLine($"\n── {Names.Of(language)} ──");

    var trackCount = 0;
    var decoyCount = 0;
    var touched = 0;

    foreach (var artist in roster[language])
    {
        // 兩個額度都滿了就不用再問了。省下來的不只是時間，
        // 也是對方伺服器的請求數——這支工具沒有理由多打。
        if (trackCount >= options.TracksPerLanguage && decoyCount >= options.DecoysPerLanguage) break;

        var found = await client.SearchAsync(artist, searchLimit, default);
        requests++;
        touched++;

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
            .Where(t => seenIds.Add(t.TrackId))
            .Where(t => seenTitles.Add($"{t.Title}|{t.Artist}"))
            .ToList();

        // 有試聽網址的才能出題；沒有的降級成誘餌。
        var playable = usable.Where(t => !string.IsNullOrWhiteSpace(t.PreviewUrl)).ToList();

        var room = Math.Max(0, options.TracksPerLanguage - trackCount);
        var picked = playable.Take(Math.Min(options.PerArtist, room)).ToList();

        tracks.AddRange(picked.Select(t => new Track(t.TrackId, t.Title, t.Artist, language, t.PreviewUrl!)));
        trackCount += picked.Count;

        var decoyRoom = Math.Max(0, options.DecoysPerLanguage - decoyCount);
        var leftovers = usable
            .Except(picked)
            .Take(Math.Min(options.DecoysPerArtist, decoyRoom))
            .ToList();

        decoys.AddRange(leftovers.Select(t => new Decoy(t.Title, t.Artist, language)));
        decoyCount += leftovers.Count;

        Console.WriteLine($"  {artist}：題庫 +{picked.Count}（{trackCount}）、"
                          + $"誘餌 +{leftovers.Count}（{decoyCount}）");
    }

    Console.WriteLine($"  ▸ {Names.Of(language)}：問了 {touched} 位演出者，"
                      + $"{trackCount} 首可出題、{decoyCount} 個誘餌");

    if (trackCount < options.TracksPerLanguage)
    {
        Console.WriteLine($"    （沒撈滿 {options.TracksPerLanguage} 首——"
                          + "名單裡的人用完了。到 Artists.cs 加幾位，或多開一條管道。）");
    }
}

// ── 和上一版合併 ──────────────────────────────────────────────
//
// 每個月重跑會換一批新榜，但不該把上個月的整批丟掉，理由有兩個：
//
//   一、**一條管道壞掉就少一個語種。** 榜單是外部服務。重跑時剛好連不上，
//       直接覆蓋就會產出一份缺語種的題庫，而且是靜悄悄的。
//   二、**換血要平順。** 上個月紅、這個月掉榜的歌，玩家未必忘了。
//
// 做法：這個月的新歌優先，但只佔上限的一部分（--carry 決定留多少給舊的），
// 剩下的名額先給上一版還在、這次沒撈到的歌，還有空位才用更多新歌補滿。

var carried = 0;

if (options.Carry > 0)
{
    var previous = BankReader.TryRead(options.Output);

    if (previous is null)
    {
        Console.WriteLine("\n── 合併 ──\n  沒有上一版（或讀不懂），這次是全新建。");
    }
    else
    {
        Console.WriteLine("\n── 合併 ──");
        Console.WriteLine($"  上一版：{previous.Value.Tracks.Count} 首、{previous.Value.Decoys.Count} 誘餌");

        var freshIds = tracks.Select(t => t.Id).ToHashSet();
        var freshTitles = tracks.Select(t => $"{t.Title}|{t.Artist}").ToHashSet(StringComparer.OrdinalIgnoreCase);
        var decoyTitles = decoys.Select(d => $"{d.Title}|{d.Artist}").ToHashSet(StringComparer.OrdinalIgnoreCase);

        var merged = new List<Track>();
        var mergedDecoys = new List<Decoy>();

        foreach (var language in Languages.InBank)
        {
            var fresh = tracks.Where(t => t.Language == language).ToList();
            var old = previous.Value.Tracks
                .Where(t => t.Language == language)
                .Where(t => !freshIds.Contains(t.Id))
                .Where(t => !freshTitles.Contains($"{t.Title}|{t.Artist}"))
                .ToList();

            // 留給舊歌的名額。新歌不夠多的時候（管道壞了）這個數字會自動放大。
            var reserved = Math.Min((int)(options.TracksPerLanguage * options.Carry), old.Count);
            var newRoom = Math.Max(0, options.TracksPerLanguage - reserved);

            var kept = fresh.Take(newRoom).ToList();
            var carryOver = old.Take(options.TracksPerLanguage - kept.Count).ToList();

            merged.AddRange(kept);
            merged.AddRange(carryOver);

            // 還有空位（舊的也不夠）就拿更多新歌補滿。
            merged.AddRange(fresh.Skip(kept.Count).Take(options.TracksPerLanguage - kept.Count - carryOver.Count));

            carried += carryOver.Count;

            // 誘餌同樣處理，但它沒有 id，只能靠「歌名｜歌手」去重。
            var freshDecoys = decoys.Where(d => d.Language == language).ToList();
            var oldDecoys = previous.Value.Decoys
                .Where(d => d.Language == language)
                .Where(d => !decoyTitles.Contains($"{d.Title}|{d.Artist}"))
                .ToList();

            var decoyReserved = Math.Min((int)(options.DecoysPerLanguage * options.Carry), oldDecoys.Count);
            var decoyRoom = Math.Max(0, options.DecoysPerLanguage - decoyReserved);

            var keptDecoys = freshDecoys.Take(decoyRoom).ToList();
            var carryDecoys = oldDecoys.Take(options.DecoysPerLanguage - keptDecoys.Count).ToList();

            mergedDecoys.AddRange(keptDecoys);
            mergedDecoys.AddRange(carryDecoys);
            mergedDecoys.AddRange(freshDecoys.Skip(keptDecoys.Count)
                .Take(options.DecoysPerLanguage - keptDecoys.Count - carryDecoys.Count));

            Console.WriteLine($"  {Names.Of(language)}：這個月 {kept.Count} 首 ＋ 上一版留下 {carryOver.Count} 首");
        }

        tracks = merged;
        decoys = mergedDecoys;
    }
}

// ── 收工 ──────────────────────────────────────────────────────

var bank = new SongBank { Tracks = tracks, Decoys = decoys };
bank.Save(options.Output);


var size = new FileInfo(options.Output).Length;

Console.WriteLine($"\n完成：{tracks.Count} 首可出題、{decoys.Count} 個誘餌"
                  + $"（共 {tracks.Count + decoys.Count} 個選項來源）");
Console.WriteLine($"送出 {requests} 次搜尋，檔案 {size / 1024} KB"
                  + (carried > 0 ? $"，其中 {carried} 首是從上一版留下來的" : ""));

foreach (var language in Languages.InBank)
{
    var t = tracks.Count(x => x.Language == language);
    var d = decoys.Count(x => x.Language == language);
    Console.WriteLine($"  {Names.Of(language)}：{t} 首 ＋ {d} 誘餌"
                      + (t == 0 ? "　← 一首都沒有，這個語種會開不了場" : ""));
}

if (tracks.Count < 90)
{
    Console.WriteLine("\n（提醒：可出題的歌少於 90 首，闖關模式六關會不夠用。）");
}

if (size > 600 * 1024)
{
    Console.WriteLine($"\n（提醒：題庫 {size / 1024} KB，每個玩家一進站就要下載它。"
                      + "攤位現場多半是手機網路，這個大小會讓開場等很久。）");
}

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
        Language.Cantonese => "粵語",
        _ => language.ToString(),
    };
}

/// <summary>命令列參數。</summary>
internal sealed record BuilderOptions(
    string Output,
    int PerArtist,
    int DecoysPerArtist,
    int TracksPerLanguage,
    int DecoysPerLanguage,
    string Country,
    TimeSpan Delay,
    int ChartLimit,
    double Carry);

internal static class CommandLine
{
    public static BuilderOptions Parse(string[] args)
    {
        var output = DefaultOutput();
        var perArtist = 15;          // 一位演出者取幾首進題庫
        var decoysPerArtist = 14;    // 同一位再取幾首當誘餌
        var tracks = 450;            // 每個語種的題庫上限
        var decoys = 500;            // 每個語種的誘餌上限
        var country = "TW";
        // 800 而不是 400：改成榜單兩段式之後請求數變成三四倍，
        // 400 毫秒實測會一直吃到 Apple 的 403／429（退讓重試撐得住，但那是
        // 「對方在擋我們」的訊號，不是可以無視的雜訊）。
        // 這支工具一個月只跑一次，多花幾分鐘換不被擋是划算的。
        var delay = TimeSpan.FromMilliseconds(800);

        var chartLimit = 100;        // 榜單一次要幾名（Apple 實測上限 100）
        var carry = 0.30;            // 上限裡留多少比例給上一版的歌（0 = 直接覆蓋）

        for (var i = 0; i < args.Length - 1; i += 2)
        {
            var value = args[i + 1];
            switch (args[i])
            {
                case "--out": output = Path.GetFullPath(value); break;
                case "--per-artist": perArtist = int.Parse(value); break;
                case "--decoys-per-artist": decoysPerArtist = int.Parse(value); break;
                case "--tracks": tracks = int.Parse(value); break;
                case "--decoys": decoys = int.Parse(value); break;
                case "--country": country = value; break;
                case "--delay": delay = TimeSpan.FromMilliseconds(double.Parse(value)); break;
                case "--chart-limit": chartLimit = int.Parse(value); break;
                case "--carry": carry = double.Parse(value); break;
            }
        }

        return new BuilderOptions(output, perArtist, decoysPerArtist, tracks, decoys, country, delay, chartLimit, Math.Clamp(carry, 0, 0.9));
    }

    /// <summary>預設寫到網頁讀的位置，讓「跑完就能玩」成立。</summary>
    private static string DefaultOutput()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "SongQuiz.sln")))
            dir = Path.GetDirectoryName(dir);

        dir ??= Directory.GetCurrentDirectory();
        return Path.Combine(dir, "web", "data", "bank.js");
    }
}
