using System.Text.Json;
using System.Text.Json.Serialization;
using SongQuiz.Common;
using SongQuiz.Game;
using SongQuiz.Quiz;
using SongQuiz.Server;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
});

// 題庫在啟動時讀一次進記憶體。題庫更新的流程是「跑 BankBuilder，重啟伺服器」，
// 因為一天之內題庫不會變，沒必要為熱重載付出複雜度。
var bankPath = BankPath.Resolve(builder.Configuration["BankPath"], builder.Environment.ContentRootPath);
var bank = SongBank.LoadOrEmpty(bankPath);

builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddSingleton(bank);
builder.Services.AddSingleton<SessionStore>();

var app = builder.Build();

app.Logger.LogInformation("題庫：{Count} 首可出題、{Decoys} 個誘餌（{Path}）",
    bank.Tracks.Count, bank.Decoys.Count, bankPath);

app.UseDefaultFiles();
app.UseStaticFiles();

// ---- 題庫狀態：前端開場要知道題庫在不在 ----
app.MapGet("/api/bank", (SessionStore store) => Results.Ok(new
{
    tracks = store.Bank.Tracks.Count,
    decoys = store.Bank.Decoys.Count,
    empty = store.Bank.IsEmpty,
    // 鍵要和其他端點的語種寫法一致（camelCase），前端才有辦法用同一份對照表翻成中文。
    census = store.Bank.Census().ToDictionary(
        kv => JsonNamingPolicy.CamelCase.ConvertName(kv.Key.ToString()),
        kv => kv.Value),
}));

// ---- 試聽：調音量用。隨便給一首歌的試聽網址，不洩漏任何題目資訊 ----
app.MapGet("/api/bank/sample", (SessionStore store) =>
{
    if (store.Bank.IsEmpty) return Results.NotFound();
    var track = store.Bank.Tracks[Random.Shared.Next(store.Bank.Tracks.Count)];
    return Results.Ok(new { previewUrl = track.PreviewUrl });
});

// ---- 開一場 ----
app.MapPost("/api/games", (StartRequest body, SessionStore store) =>
{
    if (store.Bank.IsEmpty)
        return Results.Problem("題庫是空的。請先跑 tools/SongQuiz.BankBuilder 建題庫。", statusCode: 503);

    var session = store.Create(body.Mode);
    return Results.Ok(new
    {
        id = session.Id,
        mode = session.Mode,
        stage = session.Stage,
        scoreToClear = session.CurrentStage?.ScoreToClear ?? 0,
        stageCount = Rules.StageCount,
        perfectScore = Rules.PerfectScore,
    });
});

// ---- 要下一題 ----
app.MapPost("/api/games/{id}/question", (string id, SessionStore store) =>
{
    var session = store.Find(id);
    if (session is null) return Results.NotFound(new { error = "這場遊戲不存在或已過期。" });

    var view = session.NextQuestion();
    return view is null
        ? Results.Ok(new { done = true, status = session.Status })
        : Results.Ok(view);
});

// ---- 作答（choiceId 傳 null 代表時間到沒選） ----
app.MapPost("/api/games/{id}/answer", (string id, AnswerRequest body, SessionStore store) =>
{
    var session = store.Find(id);
    if (session is null) return Results.NotFound(new { error = "這場遊戲不存在或已過期。" });
    if (session.Status != GameStatus.AwaitingAnswer)
        return Results.Conflict(new { error = "現在沒有等待作答的題目。", status = session.Status });

    return Results.Ok(session.Answer(body.ChoiceId));
});

// ---- 結算 ----
app.MapGet("/api/games/{id}/result", (string id, SessionStore store) =>
{
    var session = store.Find(id);
    if (session is null) return Results.NotFound(new { error = "這場遊戲不存在或已過期。" });

    return Results.Ok(new
    {
        mode = session.Mode,
        status = session.Status,
        stage = session.Stage,
        stageCount = Rules.StageCount,
        roundScore = session.RoundScore,
        totalScore = session.TotalScore,
        perfectScore = Rules.PerfectScore,
        records = session.Records.Select(r => new
        {
            r.Title,
            r.Artist,
            language = r.Language,
            r.Correct,
            r.Gained,
            seconds = Math.Round(r.Elapsed.TotalSeconds, 1),
        }),
    });
});

app.Run();

/// <summary>開一場遊戲的請求。</summary>
internal sealed record StartRequest(GameMode Mode);

/// <summary>作答請求；null 代表逾時未作答。</summary>
internal sealed record AnswerRequest(int? ChoiceId);
