namespace SongQuiz.Common;

/// <summary>
/// 洗牌與抽樣。出題需要「同一題庫、不同順序」，測試又需要「同一顆種子、結果一樣」，
/// 所以隨機源一律從外面傳進來。
/// </summary>
public static class Shuffling
{
    /// <summary>原地洗牌（Fisher–Yates）。</summary>
    public static void Shuffle<T>(this IList<T> items, Random random)
    {
        for (var i = items.Count - 1; i > 0; i--)
        {
            var j = random.Next(i + 1);
            (items[i], items[j]) = (items[j], items[i]);
        }
    }

    /// <summary>不重複抽 <paramref name="count"/> 個；來源不足就全給。</summary>
    public static List<T> Sample<T>(this IEnumerable<T> source, int count, Random random)
    {
        var pool = source.ToList();
        pool.Shuffle(random);
        return pool.Take(count).ToList();
    }
}
