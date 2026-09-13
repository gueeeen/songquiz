namespace SongQuiz.Server;

/// <summary>
/// 題庫檔在哪裡。
/// </summary>
/// <remarks>
/// 同一份程式會用三種方式啟動：<c>dotnet run --project</c>（工作目錄是專案）、
/// <c>dotnet 某個.dll</c>（工作目錄是你 cd 到的地方）、以及 publish 後的單檔。
/// 三者的 ContentRoot 不一樣，所以「data/bank.json」這個相對路徑不能只試一個起點，
/// 否則會出現「題庫明明建好了，畫面卻說題庫是空的」這種最難查的問題。
/// </remarks>
public static class BankPath
{
    private const string Default = "data/bank.json";

    /// <summary>依序試 ContentRoot 與執行檔所在目錄；都沒有就回 ContentRoot 版本當作「應該在這」。</summary>
    public static string Resolve(string? configured, string contentRoot)
    {
        var relative = string.IsNullOrWhiteSpace(configured) ? Default : configured;

        if (Path.IsPathRooted(relative)) return Path.GetFullPath(relative);

        foreach (var root in new[] { contentRoot, AppContext.BaseDirectory })
        {
            var candidate = Path.GetFullPath(Path.Combine(root, relative));
            if (File.Exists(candidate)) return candidate;
        }

        return Path.GetFullPath(Path.Combine(contentRoot, relative));
    }
}
