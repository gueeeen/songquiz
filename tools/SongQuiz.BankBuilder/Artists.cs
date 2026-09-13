using SongQuiz.Quiz;

namespace SongQuiz.BankBuilder;

/// <summary>
/// 題庫的來源名單。要換歌就改這裡，不要改抓取邏輯。
/// </summary>
/// <remarks>
/// 用「演出者」而不是排行榜當入口，是為了讓語種分類可信：
/// 排行榜混語種，分類只能靠猜；從演出者出發，語種是名單本身就決定好的。
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
