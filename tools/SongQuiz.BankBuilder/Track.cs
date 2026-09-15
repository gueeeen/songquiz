using System.Text.Json.Serialization;

namespace SongQuiz.BankBuilder;

/// <summary>
/// 歌曲的語種分類。闖關模式就是靠這個逐關擴充題庫範圍。
/// </summary>
/// <remarks>
/// 這裡列出的是「分得出來的」語種，不等於「遊戲裡玩得到的」——
/// 後者由 <see cref="Languages.InBank"/> 決定（見 Languages.cs）。
///
/// 兩者分開的理由：粵語有一條現成的排行榜管道，分類也很準，
/// 但遊戲裡還沒有那個選項。如果把粵語歌當成華語收進來，
/// 華語場就會冒出粵語歌——那是錯的。所以它要有自己的分類，
/// 只是暫時不寫進題庫檔。
/// </remarks>
public enum Language
{
    Mandarin,   // 華語
    Taiwanese,  // 台語
    Western,    // 西洋
    Korean,     // 韓語
    Japanese,   // 日語
    Cantonese,  // 粵語——分得出來，但還沒開放（見 Languages.cs）
}


/// <summary>
/// 一首歌。<paramref name="PreviewUrl"/> 指向 Apple Music 官方 30 秒試聽，
/// 音檔由 Apple 的伺服器直接串給瀏覽器——本專案不轉存、不代理、不快取音訊。
/// </summary>
/// <param name="Id">穩定識別碼，用 Apple 的 trackId。</param>
/// <param name="Title">歌名，已去掉副標與版本註記（見 TitleCleaner）。</param>
/// <param name="Artist">演出者。</param>
/// <param name="Language">語種分類。</param>
/// <param name="PreviewUrl">30 秒試聽網址。</param>
public sealed record Track(
    long Id,
    string Title,
    string Artist,
    Language Language,
    string PreviewUrl)
{
    /// <summary>選項上顯示的字串。算出來的，不進題庫檔。</summary>
    [JsonIgnore]
    public string Label => $"{Title} — {Artist}";
}

/// <summary>
/// 只當錯誤選項用的歌名。它們不會被出題，存在的目的是讓九個選項看起來一樣合理，
/// 玩家不能靠「這幾首我沒聽過所以答案是剩下那首」來刷分。
/// </summary>
/// <param name="Title">歌名。</param>
/// <param name="Artist">演出者。</param>
/// <param name="Language">語種——誘餌要和題目同語種才有干擾力。</param>
public sealed record Decoy(string Title, string Artist, Language Language)
{
    [JsonIgnore]
    public string Label => $"{Title} — {Artist}";
}
