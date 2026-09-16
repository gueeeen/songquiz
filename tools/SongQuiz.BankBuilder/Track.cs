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

    /// <summary>
    /// 知名度分數，**越小越有名**。只在建題庫的過程中用，不進題庫檔。
    /// </summary>
    /// <remarks>
    /// 沒有任何公開來源給得到「播放次數」這個絕對數字（Apple 沒有，
    /// Spotify 只給 0～100 的相對熱度而且要註冊金鑰）。所以這裡用兩個
    /// 手上已經有的排名合成：
    ///
    ///   * **歌手有多紅**：他在排行榜上的名次。榜是真的播放排行。
    ///   * **這首歌在他的歌裡有多紅**：Search API 回傳結果的順序。
    ///     實測是知名度排序（周杰倫回「晴天、七里香…」，
    ///     Taylor Swift 回「Cruel Summer、Love Story…」）。
    ///
    /// 合成方式讓歌手的名次主導、歌的順序當細分——
    /// 一線歌手的第五首歌，多數人還是比三線歌手的第一首熟。
    /// </remarks>
    public int Fame { get; init; }

    /// <summary>
    /// 難度：0 簡單、1 中等、2 困難。依 Fame 在同語種裡的位置切出來（見 Difficulty）。
    /// 這一個**會**進題庫檔，出題時照比例挑。
    /// </summary>
    public int Tier { get; init; }
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
