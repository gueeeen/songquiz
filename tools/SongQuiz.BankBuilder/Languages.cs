namespace SongQuiz.BankBuilder;

/// <summary>
/// 哪些語種真的會寫進題庫檔。
/// </summary>
/// <remarks>
/// 這一份和 <see cref="Language"/> 分開，是因為兩件事本來就不一樣：
///
///   * <see cref="Language"/>：**分得出來**的語種。粵語有自己的排行榜管道、
///     Apple 自己標的曲風，分類很準。
///   * 這一份：**遊戲裡玩得到**的語種。要和網頁端 js/rules.js 的 LANGUAGES 一致。
///
/// 為什麼要分：粵語的管道已經接好了，但遊戲裡還沒有那個選項。
/// 如果讓它跟著進題庫，兩種壞法二選一——把它算成華語（華語場會冒出粵語歌，
/// 那是錯的），或是照實標成粵語卻沒人選得到（每個玩家白下載一百多 KB）。
/// 所以它有分類、有管道，只是暫時不寫出去。
///
/// **要開放粵語，改兩個地方：**
///   1. 這一份加上 Language.Cantonese
///   2. web/js/rules.js 的 LANGUAGES 加上 'cantonese'（名稱已經備好了）
/// 然後重建題庫。題庫檔多出粵語、首頁多一顆膠囊，其他都不用動——
/// 闖關的關卡數、題庫容量檢查、誘餌挑選全部是照語種清單算出來的。
/// </remarks>
public static class Languages
{
    public static readonly Language[] InBank =
    [
        Language.Mandarin,
        Language.Taiwanese,
        Language.Western,
        Language.Korean,
        Language.Japanese,
        // Language.Cantonese,  ← 開放粵語就把這一行的註解拿掉（另見 rules.js）
    ];

    public static bool IsInBank(Language language) => Array.IndexOf(InBank, language) >= 0;
}
