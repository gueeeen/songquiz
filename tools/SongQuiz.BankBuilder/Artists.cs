namespace SongQuiz.BankBuilder;

/// <summary>
/// 手打的演出者名單。現在是**備源**，不是主力。
/// </summary>
/// <remarks>
/// 主力改成排行榜（見 Charts.cs）：那是真的播放排行，每個月重撈就會自動換人，
/// 而這份名單不會自己更新，「誰紅」也是人猜的。
///
/// 那為什麼還留著？兩個用途，都還在發揮：
///
/// 一、**補榜單撈不滿的語種。** 韓語只有台灣商店那一條管道（韓國商店的 RSS
///     實測是空的），撈到的人比其他語種少，缺的部分靠這份名單補。
/// 二、**補經典。** 榜單只看「現在在紅」，五月天、伍佰、江蕙這種長青的
///     不一定每個月都在榜上，但它們正是猜歌最有把握被認出來的歌。
///
/// 兩邊的名單會合併去重，榜單的人排在前面（先撈最紅的，因為題庫有上限）。
/// </remarks>

public static class Artists
{
    public static readonly IReadOnlyDictionary<Language, string[]> ByLanguage = new Dictionary<Language, string[]>
    {
        [Language.Mandarin] =
        [
            "周杰倫", "五月天", "蔡依林", "林俊傑", "田馥甄", "告五人", "鄧紫棋",
            "孫燕姿", "張惠妹", "韋禮安", "陳奕迅", "蘇打綠", "盧廣仲", "李榮浩",
            "徐佳瑩", "周興哲", "八三夭", "魏如萱", "楊丞琳", "動力火車",
        ],
        [Language.Taiwanese] =
        [
            "伍佰", "茄子蛋", "江蕙", "蕭煌奇", "滅火器", "謝金燕",
            "黃乙玲", "鄭進一", "玖壹壹", "康康",
        ],
        [Language.Western] =
        [
            "Taylor Swift", "Ed Sheeran", "Bruno Mars", "Billie Eilish", "Adele",
            "Maroon 5", "Coldplay", "The Weeknd", "Ariana Grande", "Charlie Puth",
            "Dua Lipa", "Sia", "Katy Perry", "OneRepublic",
        ],
        [Language.Korean] =
        [
            "BTS", "BLACKPINK", "TWICE", "IU", "NewJeans",
            "SEVENTEEN", "EXO", "Red Velvet", "BIGBANG", "aespa",
        ],
        [Language.Japanese] =
        [
            "YOASOBI", "米津玄師", "Official髭男dism", "LiSA", "星野源",
            "あいみょん", "RADWIMPS", "King Gnu", "宇多田ヒカル", "Perfume",
        ],
    };
}
