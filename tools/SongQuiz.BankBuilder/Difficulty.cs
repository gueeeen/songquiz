namespace SongQuiz.BankBuilder;

/// <summary>
/// 把每個語種的歌依知名度切成三級。
/// </summary>
/// <remarks>
/// 為什麼要分級：原本九個選項是從整個語種隨機抽的，所以一首冷門歌
/// 和一首國民歌被抽中的機率一樣——玩起來就是「大部分題目沒聽過」。
/// 分級之後出題可以偏向有名的（比例在 web/js/rules.js 的 DIFFICULTY_MIX）。
///
/// 為什麼是 50/25/25 而不是平均三份：簡單那一級要夠大，
/// 才有足夠的不重複題目支撐「六成的題目都從這裡出」。
///
/// **這裡切的是「相對」難度，不是絕對的。** 沒有播放次數這種絕對數字可用，
/// 所以第 1 名和第 225 名都叫「簡單」——它的意思是「在這個語種裡算好認的一半」。
/// </remarks>
public static class Difficulty
{
    /// <summary>簡單那一級佔多少。</summary>
    public const double EasyShare = 0.50;

    /// <summary>中等那一級佔多少。剩下的是困難。</summary>
    public const double MediumShare = 0.25;

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
