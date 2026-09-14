using Microsoft.Extensions.FileProviders;
using SongQuiz.LanServer;

// 用法：跑「區域網路開房.cmd」。要換埠或換網站資料夾就接在後面：
//   區域網路開房.cmd [--port 5000] [--web 路徑]
//
// 不要用 dotnet run——這台機器的 Smart App Control 會擋剛編出來、還沒有信譽的
// 執行檔（「存取被拒」）。腳本改請已簽章的 dotnet 主機載入 DLL，比較不容易被擋。
//
// 這支程式只做兩件事：
//
//   一、把 web\ 整包當靜態網站送出去。網址就是這台電腦的區域網路位址，
//       朋友用手機瀏覽器打開就能玩，不用裝任何東西。
//   二、/ws?room=XXXX 的 WebSocket 中繼：同一個房號收到的訊息，
//       原封不動轉給同房的其他連線（不回送給發送者本人）。
//
// 為什麼要有這支程式：原本跨裝置只有 Supabase 一條路，那條路要註冊帳號、抄金鑰、
// 還得把網站放到 https 上。但實際情境是「朋友在同一個場地、同一個 Wi-Fi」——
// 那根本不需要外部服務，用主辦人這台電腦當中繼就夠了，而且零帳號、零設定、零費用。
//
// **這支程式不懂遊戲。** 不判分、不判誰先答對、不存任何東西，也不看封包裡是什麼。
// 裁判仍然是房主那一頁（web/js/room.js 的 arbitrate）。理由寫在 Relay 的註解上。

// 主控台輸出中文：Windows 預設 cp950，不換成 UTF-8 會變亂碼。
Console.OutputEncoding = System.Text.Encoding.UTF8;

var port = ArgValue(args, "--port") is { } rawPort && int.TryParse(rawPort, out var parsed) ? parsed : 5000;
var webRoot = ArgValue(args, "--web") ?? FindWebRoot();

if (webRoot is null)
{
    Console.WriteLine("找不到 web 資料夾（往上找了八層都沒看到 web 裡的 room.html）。");
    Console.WriteLine("請從專案裡跑「區域網路開房.cmd」，或自己指定：--web 你的 web 資料夾路徑");
    return 1;
}

var builder = WebApplication.CreateBuilder(args);

// 監聽 0.0.0.0 而不是 localhost：localhost 只有這台電腦自己連得到，
// 而這支程式存在的唯一理由就是讓「別台裝置」連得到。
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

// 預設的 Information 會把每一個請求都印出來，一場遊戲幾百則訊息會把
// 真正重要的那一行（區域網路網址）洗掉。只留警告與錯誤。
builder.Logging.SetMinimumLevel(LogLevel.Warning);

builder.Services.AddSingleton<Relay>();

var app = builder.Build();

app.UseWebSockets();

// 網頁用這一支問「這個來源有沒有中繼」。
// 為什麼要有它：web/js/realtime.js 必須自動決定走區域網路還是走 Supabase，
// 而「網頁是從 http:// 載來的」不等於「這個伺服器會中繼」——
// 放在 GitHub Pages 上的同一份檔案也是 http(s)。回一個明確的招牌最省事，
// 也比「直接開 WebSocket 失敗再退讓」快得多（失敗的握手要等到 TCP 逾時）。
app.MapGet("/api/ping", (Relay relay) => Results.Json(new
{
    service = "songquiz-lan",
    relay = true,
    rooms = relay.RoomCount,
}));

app.Map("/ws", async (HttpContext context, Relay relay, ILoggerFactory loggers) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsync("這一支只收 WebSocket，請用 /ws?room=房號 連進來。");
        return;
    }

    var room = RoomSocket.NormalizeRoom(context.Request.Query["room"]);
    if (room is null)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsync("少了房號：/ws?room=房號");
        return;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    var peer = relay.Join(room, socket);

    try
    {
        // 傳 RequestAborted：連線斷掉或伺服器要收工時，收發迴圈要跟著停。
        await RoomSocket.PumpAsync(relay, room, peer, loggers.CreateLogger("Relay"), context.RequestAborted);
    }
    catch (Exception error)
    {
        // 任何一條連線出事都不能拖垮伺服器——同一間房的其他人還在玩。
        loggers.CreateLogger("Relay").LogWarning(error, "房間 {Room} 的一條連線異常結束。", room);
    }
    finally
    {
        relay.Leave(room, peer);
    }
});

// 靜態檔：web\ 就是網站本體，一個字都不改地送出去。
// 用 PhysicalFileProvider 指到專案裡的 web\，而不是把檔案複製到 bin\——
// 複製一份的話，改了 web\ 裡的檔要重新建置才看得到，那對一個純靜態站是莫名其妙的。
var files = new PhysicalFileProvider(Path.GetFullPath(webRoot));
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
app.UseStaticFiles(new StaticFileOptions { FileProvider = files });

app.Lifetime.ApplicationStarted.Register(() => PrintBanner(port, webRoot));

try
{
    app.Run();
}
catch (IOException error)
{
    // 最常見的是「這個埠已經有人在用」——可能是上一次忘了關的同一支程式。
    Console.WriteLine();
    Console.WriteLine($"伺服器起不來：{error.Message}");
    Console.WriteLine($"如果是「位址已在使用中」，先把上一個視窗關掉，或換一個埠：--port {port + 1}");
    return 1;
}

return 0;

/// <summary>從 args 裡撈一個 --名稱 值。沒有就回 null。</summary>
static string? ArgValue(string[] args, string name)
{
    for (var i = 0; i < args.Length - 1; i++)
    {
        if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
    }

    return null;
}

/// <summary>
/// 從執行檔所在位置往上找 web\room.html。
/// 為什麼用找的而不是寫死相對路徑：執行檔在 bin\Debug\net8.0\ 底下，
/// 寫死「往上四層」的話，哪天改成 Release 或換了 TargetFramework 就會斷，
/// 而且斷掉的樣子是「網站是空的」，不容易看出原因。
/// </summary>
static string? FindWebRoot()
{
    var here = new DirectoryInfo(AppContext.BaseDirectory);

    for (var depth = 0; depth < 8 && here is not null; depth++, here = here.Parent)
    {
        var candidate = Path.Combine(here.FullName, "web");
        if (File.Exists(Path.Combine(candidate, "room.html"))) return candidate;
    }

    return null;
}

/// <summary>
/// 啟動訊息。這是整支程式對使用者唯一有用的輸出，所以寫成「可以直接念給朋友聽」的形式。
/// </summary>
static void PrintBanner(int port, string webRoot)
{
    var addresses = LocalAddresses.LanIPv4();

    Console.WriteLine();
    Console.WriteLine("  ────────────────────────────────────────────────");
    Console.WriteLine("   猜歌王 · 區域網路房間　伺服器已啟動");
    Console.WriteLine("  ────────────────────────────────────────────────");
    Console.WriteLine();
    Console.WriteLine($"   網站資料夾：{Path.GetFullPath(webRoot)}");
    Console.WriteLine();

    if (addresses.Count == 0)
    {
        Console.WriteLine("   找不到區域網路位址——這台電腦好像沒有連上任何網路。");
        Console.WriteLine("   先連上 Wi-Fi（和朋友同一個），再重跑一次。");
        Console.WriteLine();
        Console.WriteLine($"   自己這台可以先玩：http://localhost:{port}/room.html");
    }
    else
    {
        Console.WriteLine("   叫朋友用手機瀏覽器打開這個網址（要連同一個 Wi-Fi）：");
        Console.WriteLine();

        foreach (var entry in addresses)
        {
            Console.WriteLine($"        http://{entry.Address}:{port}/room.html");
            Console.WriteLine($"            （網卡：{entry.Adapter}）");
        }

        Console.WriteLine();
        Console.WriteLine("   有好幾個就一個一個試——開得起來的那個就是對的。");
        Console.WriteLine($"   單人版在同一個位址的根目錄：http://{addresses[0].Address}:{port}/");
    }

    Console.WriteLine();
    Console.WriteLine("   第一次跑的話，Windows 防火牆會跳出提示，要按「允許存取」，");
    Console.WriteLine("   而且「私人網路」那個勾要打勾，不然朋友連不進來。");
    Console.WriteLine();
    Console.WriteLine("   要收工就關掉這個視窗（或按 Ctrl+C）。");
    Console.WriteLine();
}
