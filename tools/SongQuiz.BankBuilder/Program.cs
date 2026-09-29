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

// 名單要連「這個人有多紅」一起記：那是難度分級的一半訊號（另一半是歌在他歌裡的順序）。
// 榜上的人用名次；備源名單的人沒有名次，給該語種榜單人數的一半——
// 他們是長青歌手，不是當紅也不是冷門，硬給最後一名會把周杰倫判成「困難」。
// 第三個欄位是「這是手打名單上的經典歌手嗎」。要分開是因為兩種人該取的歌數不同：
// 榜單上的多半是新人，歌單薄，第 6 首之後就是專輯冷門歌；
// 經典歌手的前十幾首全是代表作（伍佰第 16～24 首還是牽掛、夜照亮了夜、白鴿）。
// 用同一個數字的話，不是把新人的冷門歌收進來，就是把老歌手的代表作丟掉——
// 而「太新、太難」正是現場回饋的那兩件事。
var roster = new Dictionary<Language, List<(string Name, long ArtistId, int Rank, bool Classic)>>();
// 用 id 去重，不用名字：同一位歌手在 RSS 叫「BTS」、在 Search 叫「防彈少年團」，
// 比名字會把他當成兩個人（見 Artists.cs 開頭）。
var inRoster = new Dictionary<Language, HashSet<long>>();
var chartCount = new Dictionary<Language, int>();


foreach (var language in Languages.InBank)
{
    roster[language] = [];
    inRoster[language] = [];
    chartCount[language] = 0;

}

// **經典名單要排在榜單歌手前面。**
//
// 額度是先到先得，所以誰排前面決定題庫長什麼樣。現場的回饋是「歌太新、太難」，
// 而榜單歌手的歌正是最新的那些——把他們排前面的話，題庫的額度會先被
// 「這個月在紅的新人」吃掉大半，手打的經典名單根本輪不到。
//
// 榜單的流動性由**第一層（榜上前 100 首歌）**提供，那一層是獨立的；
// 榜單歌手的其他歌只是拿來補尾巴。
Console.WriteLine("\n── 經典名單（手打）──");

foreach (var (language, artists) in Artists.ByLanguage)
{
    if (!Languages.IsInBank(language)) continue;

    var added = 0;

    foreach (var artist in artists)
    {
        if (inRoster[language].Add(artist.ArtistId))
        {
            // 名次就是在名單裡的位置。經典排最前面，Fame 比榜單歌手好——
            // 難度分級會把他們放進「簡單」，那正是要的。
            roster[language].Add((artist.Name, artist.ArtistId, roster[language].Count, true));
            added++;
        }
    }


    Console.WriteLine($"  {Names.Of(language)}：名單 {artists.Length} 位，新加入 {added} 位"
                      + $"（合計 {roster[language].Count} 位）");
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
        if (inRoster[channel.Language].Add(artist.ArtistId))
        {
            // 名次就是它在名單裡的位置：同一個語種可能有好幾條管道，
            // 先進來的（比較前面的榜、比較前面的名次）名次比較好。
            roster[channel.Language].Add((artist.Name, artist.ArtistId, roster[channel.Language].Count, false));
            chartCount[channel.Language]++;
            added++;
        }
    }


    Console.WriteLine(artists.Count == 0
        ? $"  {channel.Note}：0 位——這條管道可能壞了，看看網址還通不通"
        : $"  {channel.Note}：{artists.Count} 位，新加入 {added} 位");
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
// lookup 一次要回幾首。
// 要夠多：經典歌手取 15 首進題庫、14 首當誘餌，再加上「同一首歌以單曲／專輯／
// 精選重複出現」被去掉的那些。而 lookup 的第一筆是歌手本身（不是歌），所以要 +1。
var searchLimit = options.ClassicPerArtist + options.DecoysPerArtist + 20;

var requests = 0;


// ── 第一層：榜上的前幾十首歌 ────────────────────────────────
//
// 這一層決定了題庫有沒有「流動性」。
//
// 「簡單」那一級如果全部來自經典歌單，它就是固定的——玩久了會背起來。
// 榜單每個月會換一批，把它的前幾十名放在最前面，簡單那一級就會跟著換。
//
// 順序（Fame 由小到大，越小越有名，難度分級照這個切）：
//
//   ① 榜上前 N 首      每個月換　← 流動性來自這裡
//   ② 經典歌單         固定　　　← 保底，補到「簡單」填滿
//   ③ 榜單歌手的其他歌 每個月換　← 填滿剩下的，多半落在中等與困難
//
// 榜單那 100 首本身就帶試聽網址，所以這一層不用多打一次 Search API。

var chartSongs2 = 0;

Console.WriteLine("\n── 榜上的歌 ──");

foreach (var language in Languages.InBank)
{
    // **兩個額度要分開數。**
    //
    // 原本只有一個：台灣的榜先把它填滿，補深度的管道（日本本地榜、韓語 1252）
    // 就永遠讀不到——它們的歌一首都沒進題庫，而日語的「一成困難」指的正是那些。
    // 分開之後流動性和深度各有自己的量。
    var taken = 0;
    var takenDepth = 0;

    var channelOrder = 0;

    foreach (var channel in Charts.All.Where(c => c.Language == language))
    {
        var quota = channel.Depth ? options.DepthSongs : options.ChartSongs;
        var already = channel.Depth ? takenDepth : taken;
        if (already >= quota) continue;

        channelOrder++;

        var songs = await charts.SongsAsync(channel, options.ChartLimit, default);

        foreach (var song in songs)
        {
            if ((channel.Depth ? takenDepth : taken) >= quota) break;

            // 語種還是看歌自己的曲風：Pop 榜上會混進別的語種的歌。
            if (!Genres.Accepts(song.Genre, language)) continue;
            if (song.Id != 0 && !seenIds.Add(song.Id)) continue;
            if (!seenTitles.Add($"{song.Title}|{song.Artist}")) continue;

            tracks.Add(new Track(song.Id, song.Title, song.Artist, language, song.PreviewUrl)
            {
                Year = song.Year,

                // **管道的順序要算進 Fame。**
                //
                // 原本是 song.Rank - 200000，所以每條管道的第一名都一樣有名——
                // 日本本地榜的第一名和台灣 J-Pop 榜的第一名並列，兩邊都落進「簡單」。
                // 但那兩件事在這個遊戲裡不對等：台灣榜是玩家聽過的（宇多田光、
                // 米津玄師），日本榜是傑尼斯與偶像團（なにわ男子、Aぇ! group），
                // 台灣人多半不認得。日語的出題比例是「九成簡單、一成困難」，
                // 而那個「困難」指的就是日本本地榜——所以它必須排在後面。
                //
                // 乘 1000 是因為榜單一份最多 100 名，不會互相跨界。
                //
                // 補深度的管道（日本本地榜、韓語 1252）要排到**最後面**，
                // 不是最前面：那些歌同語種但這裡的人多半不認得，屬於「困難」。
                Fame = channel.Depth
                    ? 500000 + channelOrder * 1000 + song.Rank
                    : channelOrder * 1000 + song.Rank - 200000,
            });

            if (channel.Depth) takenDepth++;
            else taken++;

            chartSongs2++;
        }
    }

    Console.WriteLine($"  {Names.Of(language)}：榜上取了 {taken} 首"
                      + (takenDepth > 0 ? $"＋補深度 {takenDepth} 首" : "")
                      + (taken < options.ChartSongs ? $"（想要 {options.ChartSongs} 首，榜不夠長）" : ""));
}
// ── 先把經典歌單種進去 ──────────────────────────────────────
//
// 榜單衡量的是「這個月在紅」，猜歌需要的是「認得出來」。這兩件事重疊，
// 但不相等：周杰倫、五月天、蔡依林、伍佰、江蕙這些不一定每個月都在榜上，
// 而它們正是最有把握被喊出來的歌。
//
// 所以給它們一個非常小的 Fame（比任何榜單來的歌都小），
// 難度分級就會自動把它們放進「簡單」那一級。
// 種子檔是第一版的題庫（手挑歌手撈出來的），轉成新格式後進版控。
var classicCount = 0;

if (!string.IsNullOrWhiteSpace(options.Classics))
{
    var seed = BankReader.TryRead(options.Classics);

    if (seed is null)
    {
        Console.WriteLine($"\n── 經典歌單 ──\n  讀不到 {options.Classics}，這次不種。");
    }
    else
    {
        Console.WriteLine("\n── 經典歌單 ──");

        var order = 0;
        foreach (var track in seed.Value.Tracks)
        {
            if (!Languages.IsInBank(track.Language)) continue;
            if (!seenIds.Add(track.Id)) continue;
            if (!seenTitles.Add($"{track.Title}|{track.Artist}")) continue;

            // 負的 Fame：排在所有榜單來的歌前面。保留原本的順序，
            // 所以某個語種的經典超過「簡單」那一級的容量時，
            // 後面的會自然落到中等，而不是隨機被丟掉。
            tracks.Add(track with { Fame = order - 100000 });
            order++;
            classicCount++;
        }

        foreach (var decoy in seed.Value.Decoys)
        {
            if (!Languages.IsInBank(decoy.Language)) continue;
            if (!seenTitles.Add($"{decoy.Title}|{decoy.Artist}")) continue;
            decoys.Add(decoy);
        }

        foreach (var language in Languages.InBank)
        {
            Console.WriteLine($"  {Names.Of(language)}：{tracks.Count(t => t.Language == language)} 首經典"
                              + $"、{decoys.Count(d => d.Language == language)} 個誘餌");
        }
    }
}

foreach (var language in Languages.InBank)
{
    Console.WriteLine($"\n── {Names.Of(language)} ──");

    // 經典已經先種進去了，額度要從那裡算起。
    var trackCount = tracks.Count(t => t.Language == language);
    var decoyCount = decoys.Count(d => d.Language == language);
    var touched = 0;
    var skippedByGenre = 0;

    // 每位演出者查回來的結果留著，第二輪要用。
    //
    // 為什麼要留：每人只取 5 首（前 5 首才是有名的），但有些語種的榜上
    // 只有五十幾位演出者，五十幾乘五撈不滿一個語種——台語實測只有 240 首。
    // 這時候要嘛加手挑名單（那是明確要降低的東西），要嘛回頭在同一批
    // 演出者身上挖深一層。後者不用多打一次 API，而且挖出來的歌本來就比較冷門，
    // 難度分級會自動把它們歸到較難那一級，只佔一成的題目。
    var cache = new List<(int Rank, List<PickedSong> Songs, int Used)>();

    foreach (var (artist, artistId, artistRank, classic) in roster[language])
    {
        // 兩個額度都滿了就不用再問了。省下來的不只是時間，
        // 也是對方伺服器的請求數——這支工具沒有理由多打。
        if (trackCount >= options.TracksPerLanguage && decoyCount >= options.DecoysPerLanguage) break;

        // **用 id 撈歌，不用名字。** 名字會拿錯人：搜「LiSA」Apple 先給小野麗莎，
        // 搜「Queen」撈不到 Queen 本人，搜「Perfume」是 0 首。
        // lookup?id=… 問的是「這位歌手的歌」，沒有歧義（理由寫在 Artists.cs 開頭）。
        var found = await client.SongsOfArtistAsync(artistId, searchLimit, default);
        requests++;
        touched++;

        // 被曲風擋下來的：那些歌屬於別的語種（或粵語，目前不收）。
        skippedByGenre += found.Count(t => t.Kind == "song"
            && !string.IsNullOrWhiteSpace(t.TrackName)
            && !Genres.Accepts(t.PrimaryGenreName, language));

        var usable = found
            .Where(t => t.Kind == "song")
            .Where(t => t.TrackId != 0 && !string.IsNullOrWhiteSpace(t.TrackName))
            .Where(t => !string.IsNullOrWhiteSpace(t.ArtistName))
            // 語種看歌自己的曲風，不看是從哪條管道撈到這位歌手的。
            // **這一條必須在去重之前**：去重是「看過就記下來」，
            // 先去重的話，蕭煌奇的台語歌會在華語那一輪被記成看過、
            // 然後在台語那一輪被當成重複跳掉——結果兩邊都沒有它。
            .Where(t => Genres.Accepts(t.PrimaryGenreName, language))
            .Select(t => new PickedSong(
                t.TrackId,
                TitleCleaner.Clean(t.TrackName!),
                t.ArtistName!,
                t.PreviewUrl,
                Years.Of(t.ReleaseDate)))
            .Where(t => seenIds.Add(t.Id))
            .Where(t => seenTitles.Add($"{t.Title}|{t.Artist}"))
            .ToList();

        // 有試聽網址的才能出題；沒有的降級成誘餌。
        var playable = usable.Where(t => !string.IsNullOrWhiteSpace(t.PreviewUrl)).ToList();

        var room = Math.Max(0, options.TracksPerLanguage - trackCount);
        var wanted = classic ? options.ClassicPerArtist : options.PerArtist;
        var picked = playable.Take(Math.Min(wanted, room)).ToList();

        // 留給第二輪：這位演出者還有哪些可播的歌、已經用掉幾首。
        cache.Add((artistRank, playable, picked.Count));

        // Fame 越小越有名。往下第幾首 × SongStep ＋ 歌手名次（見 Track.Fame）。
        tracks.AddRange(picked.Select((t, index) =>
            new Track(t.Id, t.Title, t.Artist, language, t.PreviewUrl!)
            {
                Year = t.Year,
                Fame = index * Track.SongStep + artistRank,
            }));
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
                      + $"{trackCount} 首可出題、{decoyCount} 個誘餌"
                      + (skippedByGenre > 0 ? $"（另有 {skippedByGenre} 首曲風不是這個語種，讓給別的管道）" : ""));

    // 年代分佈。標籤會騙人（我以為某個歌手是九〇年代的），releaseDate 不會。
    // 第二行是出題會用到的那三格，數字太小就看得見（見 Eras.DescribeSlices）。
    Console.WriteLine($"    年代：{Eras.Describe(language, tracks)}");

    // ── 第二輪：名單用完了還不夠，就在同一批演出者身上挖深一層 ──
    //
    // 一輪挖一首（每位的第 6 首、然後第 7 首…），而不是一次把某個人挖到底——
    // 那樣會變成「台語有一百首都是同一個人的」。
    var deeper = 0;

    while (trackCount < options.TracksPerLanguage)
    {
        var addedThisRound = 0;

        for (var i = 0; i < cache.Count && trackCount < options.TracksPerLanguage; i++)
        {
            var (rank, songs, used) = cache[i];
            if (used >= songs.Count) continue;

            var song = songs[used];
            tracks.Add(new Track(song.Id, song.Title, song.Artist, language, song.PreviewUrl!)
            {
                Year = song.Year,

                // 挖越深、Fame 越大（越不有名）。和第一輪同一個公式，
                // 所以第 6 首自然排在大部分人的第 5 首之後。
                Fame = used * Track.SongStep + rank,
            });

            cache[i] = (rank, songs, used + 1);
            trackCount++;
            deeper++;
            addedThisRound++;
        }

        // 一整輪都加不到東西，表示所有人的歌都用完了。
        if (addedThisRound == 0) break;
    }

    if (deeper > 0)
    {
        Console.WriteLine($"    名單只夠 {trackCount - deeper} 首，"
                          + $"回頭在同一批演出者身上多挖了 {deeper} 首（都會落在較難的那一級）");
    }

    if (trackCount < options.TracksPerLanguage)
    {
        Console.WriteLine($"    （挖完還是只有 {trackCount} 首，少了 "
                          + $"{options.TracksPerLanguage - trackCount}。這個語種的榜就是比較小，"
                          + "要更多就得多開一條管道，或把 --tracks 調低。）");
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

// 難度是「在同語種裡的相對位置」，所以要等全部收完才算得出來。
tracks = Difficulty.Assign(tracks);

var bank = new SongBank { Tracks = tracks, Decoys = decoys };
bank.Save(options.Output);



var size = new FileInfo(options.Output).Length;

Console.WriteLine($"\n完成：{tracks.Count} 首可出題、{decoys.Count} 個誘餌"
                  + $"（共 {tracks.Count + decoys.Count} 個選項來源）");
Console.WriteLine($"送出 {requests} 次搜尋，檔案 {size / 1024} KB"
                  + (chartSongs2 > 0 ? $"，其中榜上直收 {chartSongs2} 首" : "")
                  + (classicCount > 0 ? $"、經典 {classicCount} 首" : "")
                  + (carried > 0 ? $"，其中 {carried} 首是從上一版留下來的" : ""));

foreach (var language in Languages.InBank)
{
    var t = tracks.Count(x => x.Language == language);
    var d = decoys.Count(x => x.Language == language);
    var byTier = Difficulty.Describe(tracks.Where(x => x.Language == language));
    Console.WriteLine($"  {Names.Of(language)}：{t} 首（{byTier}）＋ {d} 誘餌"
                      + (t == 0 ? "　← 一首都沒有，這個語種會開不了場" : ""));

    // 按年代切的語種（華語／台語／西洋）出題要求兩成從「今年」出。
    // 那一格有幾首是資料決定的，所以印出來。
    if (Eras.SlicedByEra(language))
    {
        Console.WriteLine($"    出題保底：{Eras.DescribeSlices(language, tracks)}");
    }
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

/// <summary>
/// 查回來、清洗過、還沒決定要當題目還是誘餌的一首歌。
/// </summary>
/// <remarks>
/// 原本是匿名型別，但第二輪要把它存進 List 跨迴圈用，匿名型別做不到。
/// </remarks>
/// <summary>
/// 某個語種的歌分佈在哪些年代。
/// </summary>
/// <remarks>
/// 存在的理由：「各年代都要有歌」這件事我沒辦法靠歌手名單保證——我可能記錯某個
/// 歌手的年代，而 Apple 也沒有年代排行榜可以對照。releaseDate 是唯一不會騙人的。
/// 每次重建都印出來，歪掉就看得見。
/// </remarks>
internal static class Eras
{
    public static string Describe(Language language, List<Track> tracks)
    {
        var buckets = new SortedDictionary<int, int>();
        var unknown = 0;

        foreach (var track in tracks)
        {
            if (track.Language != language) continue;
            if (track.Year == 0) { unknown++; continue; }

            var decade = track.Year / 10 * 10;
            buckets[decade] = buckets.TryGetValue(decade, out var had) ? had + 1 : 1;
        }

        var parts = buckets.Select(b => $"{b.Key}s {b.Value}").ToList();
        if (unknown > 0) parts.Add($"不明 {unknown}");

        return parts.Count == 0 ? "（還沒有歌）" : string.Join("、", parts);
    }

    /// <summary>
    /// 被保底的那兩格各有幾首（見 web/js/rules.js 的 ERA_MIX）。
    /// </summary>
    /// <remarks>
    /// 印它的理由和 Describe 一樣，但更直接：出題規則要求 2000 年以前的歌正好兩成、
    /// 近兩年的至少一成，而「有幾首可以抽」是資料決定的，不是我能保證的。
    ///
    /// 這個數字改過一次規則：本來新歌那格算「今年」，實測台語只有 19 首、
    /// 華語 28 首——那一格會一直重複同樣那十幾首歌，所以放寬成近兩年。
    /// 池子太薄這件事只有印出來才看得見，出題端是靜靜地退回整池的。
    /// </remarks>
    /// <summary>
    /// 這個語種的出題比例是按年代切的嗎？
    /// </summary>
    /// <remarks>
    /// 真正的規則在 web/js/rules.js（那裡才是出題的地方），這裡只是為了決定
    /// 要不要印那一行。兩邊不同步的後果是「少印一行字」，不是壞掉。
    /// </remarks>
    public static bool SlicedByEra(Language language) =>
        language is Language.Mandarin or Language.Taiwanese or Language.Western;

    /// <summary>「新歌」算幾年內。和 rules.js 的 FRESH_YEARS 是同一個數字。</summary>
    private const int FreshYears = 2;

    public static string DescribeSlices(Language language, List<Track> tracks)
    {
        var freshFrom = DateTime.UtcNow.Year - (FreshYears - 1);
        var mine = tracks.Where(t => t.Language == language).ToList();
        if (mine.Count == 0) return "（還沒有歌）";

        var classic = mine.Count(t => t.Year > 0 && t.Year < 2000);
        var fresh = mine.Count(t => t.Year >= freshFrom);
        var middle = mine.Count - classic - fresh;

        // 兩格的意思不一樣（見 rules.js 的 ERA_MIX）：老歌是上限，新歌是下限。
        // 池子太薄的話出題端會靜靜地退回整池，所以在這裡講出來。
        var thin = classic < 30 ? "　← 老歌太少，兩成會湊不滿" : "";

        return $"2000 前 {classic}（正好兩成）、{freshFrom} 年起 {fresh}（至少一成）、"
               + $"其餘 {middle}{thin}";
    }
}

internal sealed record PickedSong(long Id, string Title, string Artist, string? PreviewUrl, int Year);

/// <summary>
/// 從 "2004-08-03T12:00:00Z" 取出 2004。解不出來回 0。
/// </summary>
/// <remarks>
/// 只用來看年代覆蓋，所以解不出來不是錯——那一首就不計入任何年代的統計。
/// </remarks>
internal static partial class Years
{
    public static int Of(string? releaseDate) =>
        releaseDate is { Length: >= 4 } && int.TryParse(releaseDate[..4], out var year)
        && year is > 1900 and < 2100
            ? year
            : 0;
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
    int ClassicPerArtist,
    int DecoysPerArtist,
    int TracksPerLanguage,
    int DecoysPerLanguage,
    string Country,
    TimeSpan Delay,
    int ChartLimit,
    double Carry,
    string Classics,
    int ChartSongs,
    int DepthSongs);

internal static class CommandLine
{
    public static BuilderOptions Parse(string[] args)
    {
        var output = DefaultOutput();
        // 5 而不是 15：Search API 的前幾首是最有名的，第 6 首之後多半是
        // 專輯裡的冷門歌。抽到那些的話玩家「大部分題目沒聽過」，那是難度失控而不是難。
        var perArtist = 5;           // 榜單上的演出者取幾首進題庫
        // 經典歌手取幾首。**和榜單歌手不同是刻意的。**
        // 榜上多半是新人，歌單薄，第 6 首之後就是專輯冷門歌；經典歌手的前十幾首
        // 全是代表作——伍佰第 16～24 首還是牽掛、夜照亮了夜、白鴿。
        // 用同一個數字的話，不是收進新人的冷門歌，就是丟掉老歌手的代表作，
        // 而「太新、太難」正是現場回饋的那兩件事。
        var classicPerArtist = 15;
        var decoysPerArtist = 14;    // 同一位再取幾首當誘餌
        // 每個語種的題庫上限。450 → 700：榜單那層固定 100 首，拉高上限等於
        // 提高經典的比例（榜單佔比從 22% 降到 14%，十題一場平均新歌 2.2 → 1.4 題）。
        // 體積不是問題：bank.js 在 GitHub Pages 上有 gzip（367 KB → 162 KB），
        // 700 的話約 276 KB，而一首試聽就是 1024 KB。
        var tracks = 700;
        var decoys = 500;            // 每個語種的誘餌上限
        var country = "TW";
        // 800 而不是 400：改成榜單兩段式之後請求數變成三四倍，
        // 400 毫秒實測會一直吃到 Apple 的 403／429（退讓重試撐得住，但那是
        // 「對方在擋我們」的訊號，不是可以無視的雜訊）。
        // 這支工具一個月只跑一次，多花幾分鐘換不被擋是划算的。
        var delay = TimeSpan.FromMilliseconds(800);

        var chartLimit = 100;        // 榜單一次要幾名（Apple 實測上限 100）
        var carry = 0.30;                   // 上限裡留多少比例給上一版的歌（0 = 直接覆蓋）
        var classics = DefaultClassics();   // 一定會進題庫、而且一定算「簡單」的那些歌
        // 每個語種直接從榜上收幾首。**流動性全部來自這一層。**
        // 100 而不是 50：題庫上限拉到 700 之後，50 首只佔 7%，那個「每個月會換一批」
        // 的效果就感覺不到了。100 首約 14%，十題一場平均 1.4 題是這個月的新歌。
        var chartSongs = 100;

        // 補深度的管道另外收幾首（日本本地榜、韓語的 1252）。
        // 它們是「同語種但這裡的人多半不認得」，所以 Fame 排在最後面、算「困難」——
        // 日語的出題比例「九成簡單、一成困難」，那一成指的就是這些。
        var depthSongs = 40;

        for (var i = 0; i < args.Length - 1; i += 2)
        {
            var value = args[i + 1];
            switch (args[i])
            {
                case "--out": output = Path.GetFullPath(value); break;
                case "--per-artist": perArtist = int.Parse(value); break;
                case "--classic-per-artist": classicPerArtist = int.Parse(value); break;
                case "--decoys-per-artist": decoysPerArtist = int.Parse(value); break;
                case "--tracks": tracks = int.Parse(value); break;
                case "--decoys": decoys = int.Parse(value); break;
                case "--country": country = value; break;
                case "--delay": delay = TimeSpan.FromMilliseconds(double.Parse(value)); break;
                case "--chart-limit": chartLimit = int.Parse(value); break;
                case "--carry": carry = double.Parse(value); break;
                case "--classics": classics = value; break;
                case "--chart-songs": chartSongs = int.Parse(value); break;
                case "--depth-songs": depthSongs = int.Parse(value); break;
            }
        }

        return new BuilderOptions(output, perArtist, classicPerArtist, decoysPerArtist, tracks, decoys, country, delay, chartLimit, Math.Clamp(carry, 0, 0.9), classics, chartSongs, depthSongs);
    }

    /// <summary>經典歌單的預設位置。傳空字串就不種。</summary>
    /// <summary>
    /// 預設**不**種經典歌單。
    /// </summary>
    /// <remarks>
    /// tools/經典歌單.js 是舊流程（用名字搜歌）的產物，而那個流程會拿錯人——
    /// 它的 80 首日語裡有 13 首根本不是日文歌：小野麗莎 6 首 bossa nova、
    /// NCT 道在廷（搜「Perfume」搜到的）、布蘭妮·斯皮爾斯、Seungmin、2PM、sombr…
    /// 錯誤被烘進檔案裡，每次重建都會原封不動地種回題庫。
    ///
    /// 而它的角色已經被取代了：Artists.cs 現在有 288 位**驗證過 artistId** 的
    /// 經典歌手（日語 43 位 × 15 首 = 645 首），比種子檔多也比它乾淨。
    ///
    /// 檔案留著沒刪：要重做一份手挑歌單的話它是起點，但要先過一遍語種。
    /// 要種回去就傳 --classics tools/經典歌單.js。
    /// </remarks>
    private static string DefaultClassics() => "";

    /// <summary>預設寫到網頁讀的位置，讓「跑完就能玩」成立。</summary>
    private static string DefaultOutput() => Path.Combine(RepoRoot(), "web", "data", "bank.js");

    private static string RepoRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "SongQuiz.sln")))
            dir = Path.GetDirectoryName(dir);

        return dir ?? Directory.GetCurrentDirectory();
    }
}
