namespace SongQuiz.BankBuilder;

/// <summary>
/// 把每個語種的歌依知名度切成三級。
/// </summary>
/// <remarks>
/// 為什麼要分級：原本九個選項是從整個語種隨機抽的，所以一首冷門歌
/// 和一首國民歌被抽中的機率一樣——玩起來就是「大部分題目沒聽過」。
/// 分級之後出題可以偏向有名的（比例在 web/js/rules.js 的 DIFFICULTY_MIX）。
///
/// **40 / 30 / 30**。這三個數字各有理由：
///
/// 「簡單」的 40% 是從經典歌單回推的：初版題庫的華語經典有 160 首，
/// 而每語種上限 400 首 × 40% 剛好是 160——40% 是「讓所有華語經典都進得了
/// 簡單那一級」的最小比例。33% 的話會有 27 首擠到中等去。
///
/// 一開始是 50/25/25，太寬鬆了：「在這個語種裡算好認的一半」實際上包含
/// 很多只有粉絲認得的歌，西洋、日語、韓語特別明顯（那三個語種的長尾更長）。
///
/// 代價是簡單那一級的歌變少（每語種 400 首的話從 200 降到 160），
/// 同一首歌在不同場次重複的機率上升。十題一場還好，真的覺得重複太多
/// 就把 --tracks 調高。
///
/// **這裡切的是「相對」難度，不是絕對的。** 沒有播放次數這種絕對數字可用，
/// 所以第 1 名和第 160 名都叫「簡單」——它的意思是「在這個語種裡最好認的四成」。
/// </remarks>
public static class Difficulty
{
    /// <summary>簡單那一級佔多少。</summary>
    public const double EasyShare = 0.40;

    /// <summary>中等那一級佔多少。剩下的是困難，所以零頭會落在困難那一級。</summary>
    public const double MediumShare = 0.30;

    /// <summary>
    /// 依 Fame 在同語種裡的排序，給每一首歌貼上難度。
    /// 回傳新的清單（Track 是 record，不原地改）。
    /// </summary>
    public static List<Track> Assign(IEnumerable<Track> tracks)
    {
        var result = new List<Track>();

        foreach (var group in tracks.GroupBy(t => t.Language))
        {
            // Fame 越小越有名，所以升冪排。
            var ordered = group.OrderBy(t => t.Fame).ToList();

            var easyUntil = (int)Math.Round(ordered.Count * EasyShare);
            var mediumUntil = easyUntil + (int)Math.Round(ordered.Count * MediumShare);

            for (var i = 0; i < ordered.Count; i++)
            {
                var tier = i < easyUntil ? 0 : i < mediumUntil ? 1 : 2;
                result.Add(ordered[i] with { Tier = tier });
            }
        }

        return result;
    }

    /// <summary>跑完印出來確認分佈沒歪。</summary>
    public static string Describe(IEnumerable<Track> tracks)
    {
        var counts = new int[3];
        foreach (var track in tracks) counts[Math.Clamp(track.Tier, 0, 2)]++;
        return $"簡單 {counts[0]}、中等 {counts[1]}、困難 {counts[2]}";
    }
}
