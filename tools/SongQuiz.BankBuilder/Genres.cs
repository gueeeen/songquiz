namespace SongQuiz.BankBuilder;

/// <summary>
/// 用每一首歌自己的曲風判斷它是哪個語種。
/// </summary>
/// <remarks>
/// 為什麼需要這一層：原本語種是「從哪條管道撈到這位歌手」決定的，
/// 但**雙聲帶歌手的歌不是同一種語言**。蕭煌奇同時在華語榜和台語榜上，
/// 他的歌實際上是混的：
///
///     末班車 → 華語流行樂      上水的花 → 台灣流行樂
///     候鳥   → 華語流行樂      阿嬤的話 → 台灣流行樂
///
/// 按歌手分的話，先處理到哪一條管道就整批算哪一種，華語場就會冒出台語歌。
/// 同一個問題也會讓粵語歌混進華語（粵語歌手常常也唱華語）。
///
/// iTunes 每一筆結果都帶 primaryGenreName，而且分得很細，直接拿它判斷就好。
///
/// **判不出來的時候沿用管道的語種。** 曲風名稱是 Apple 決定的，他們隨時可以
/// 加新的；判不出來就當作「這條管道撈到的東西」，那是原本的行為，不會更糟。
/// </remarks>
public static class Genres
{
    /// <summary>
    /// 曲風名稱 → 語種。
    /// </summary>
    /// <remarks>
    /// 用「包含」比對而不是完全相等：Apple 的曲風有很多變體
    /// （華語流行樂、華語搖滾、華語嘻哈…），列舉不完，抓關鍵字比較穩。
    /// 順序有意義——先比對到的先算，所以細的要放前面
    /// （「台灣流行樂」要排在「流行樂」前面，否則會被後者吃掉）。
    /// </remarks>
    private static readonly (string Keyword, Language Language)[] Map =
    [
        // 台語。Apple 叫它「台灣流行樂」，英文介面是 Taiwanese。
        ("台灣流行", Language.Taiwanese),
        ("台語", Language.Taiwanese),
        ("Taiwanese", Language.Taiwanese),

        // 粵語。它有自己的分類，而且目前不寫進題庫——
        // 判得出來才擋得掉，不然它會混進華語。
        ("粵語", Language.Cantonese),
        ("Cantopop", Language.Cantonese),

        // 華語。
        ("華語", Language.Mandarin),
        ("國語", Language.Mandarin),
        ("中文", Language.Mandarin),
        ("Mandopop", Language.Mandarin),
        ("Chinese", Language.Mandarin),

        // 韓語。
        ("K-Pop", Language.Korean),
        ("韓國", Language.Korean),
        ("韓語", Language.Korean),
        ("Korean", Language.Korean),

        // 日語。動漫歌在 Apple 是獨立曲風，但它是日文歌。
        ("J-Pop", Language.Japanese),
        ("日本", Language.Japanese),
        ("日語", Language.Japanese),
        ("Japanese", Language.Japanese),
        ("Anime", Language.Japanese),
        ("アニメ", Language.Japanese),
    ];

    /// <summary>
    /// 這個曲風屬於哪個語種。判不出來回 null。
    /// </summary>
    /// <remarks>
    /// 英文的 Pop／Rock／Hip-Hop 這些**刻意不對應到西洋**：
    /// 它們是「沒有標語言」的意思，不是「這是英文歌」。台灣歌手的歌也常常
    /// 只標 Pop。硬把它們算成西洋，華語榜撈到的歌會整批跑去西洋。
    /// 判不出來就沿用管道的語種，那個判斷比曲風可靠。
    /// </remarks>
    public static Language? Of(string? genre)
    {
        if (string.IsNullOrWhiteSpace(genre)) return null;

        foreach (var (keyword, language) in Map)
        {
            if (genre.Contains(keyword, StringComparison.OrdinalIgnoreCase)) return language;
        }

        return null;
    }

    /// <summary>
    /// 這首歌該不該被這條管道收下。
    /// </summary>
    /// <param name="genre">歌自己的曲風。</param>
    /// <param name="channelLanguage">這條管道負責的語種。</param>
    /// <remarks>
    /// 三種情況：
    ///   * 判得出來而且就是這個語種 → 收。
    ///   * 判得出來但是別的語種 → **不收**。它會在那個語種的管道被撈到
    ///     （雙聲帶歌手通常兩個榜都在），或者就是不該進題庫（粵語）。
    ///   * 判不出來 → 收，沿用管道的語種。
    /// </remarks>
    public static bool Accepts(string? genre, Language channelLanguage)
    {
        var detected = Of(genre);
        return detected is null || detected == channelLanguage;
    }
}
