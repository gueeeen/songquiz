using System.Text.RegularExpressions;

namespace SongQuiz.Quiz;

/// <summary>
/// 歌名清洗。音樂平台的歌名常帶一串註記——(feat. …)、[Remastered]、
/// （電視劇片尾曲）——那些東西留在選項上，玩家會靠「哪個選項比較長」猜出答案。
/// </summary>
public static partial class TitleCleaner
{
    /// <summary>括號註記。</summary>
    [GeneratedRegex(@"\s*[\(\[（【][^\(\)\[\]（）【】]*[\)\]）】]")]
    private static partial Regex Brackets();

    /// <summary>清完之後可能留下的孤兒括號（來自巢狀或不成對的原始歌名）。</summary>
    [GeneratedRegex(@"[\(\)\[\]（）【】]")]
    private static partial Regex StrayBrackets();

    /// <summary>破折號之後的副標：「歌名 - Single Version」。</summary>
    [GeneratedRegex(@"\s+[-–—]\s+.*$")]
    private static partial Regex Subtitle();

    /// <summary>連續空白。</summary>
    [GeneratedRegex(@"\s{2,}")]
    private static partial Regex Spaces();

    /// <summary>
    /// 只砍註記，主歌名一個字都不動——包含歌名本身的標點（「你,好不好?」的問號要留）。
    /// </summary>
    public static string Clean(string raw)
    {
        var title = raw;

        // 巢狀括號要反覆清：「歌名 (英譯) 片尾曲)」清一輪只會拔掉內層，
        // 留下一個孤兒右括號。清到不再變動，剩下的孤兒再統一掃掉。
        while (true)
        {
            var once = Brackets().Replace(title, string.Empty);
            if (once == title) break;
            title = once;
        }

        title = StrayBrackets().Replace(title, string.Empty);
        title = Subtitle().Replace(title, string.Empty);
        title = Spaces().Replace(title, " ").Trim().Trim('、', ',', '，', '-', '–', '—').Trim();

        // 整個歌名就是一段註記（例如 "(Intro)"）時，清完會變空字串——那就留原名。
        return string.IsNullOrWhiteSpace(title) ? raw.Trim() : title;
    }
}
