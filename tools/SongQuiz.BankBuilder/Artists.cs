namespace SongQuiz.BankBuilder;

/// <summary>
/// 手挑的經典歌手名單。榜單撈不到的那一半題庫來自這裡。
/// </summary>
/// <remarks>
/// **為什麼帶 artistId 而不只是名字。**
///
/// 原本是只有名字、用 Search API 去撈歌，那有兩個會靜靜出錯的地方：
///
///   * 同名的人。搜「LiSA」Apple 會先給你小野麗莎（bossa nova）——
///     而產生器沒有「這真的是我要的人嗎」這道關卡，所以**線上的題庫真的收了
///     六首小野麗莎的英文老歌當日文歌**（Take Me Home Country Roads、
///     Fly Me To The Moon…）。玩家在日語場聽到那些，選項全是日文歌。
///   * 同一個人兩個名字。RSS 榜單叫「BTS」，Search 叫「防彈少年團」；
///     宇多田ヒカル 在 Search 裡是 Hikaru Utada。用名字比對一定會漏。
///
/// artistId 沒有這兩個問題，而且取歌改用 lookup?id=…&entity=song——
/// 那是「這位歌手的歌」，不是「搜這個詞的結果」。順便解掉另一件事：
/// 搜「Queen」撈不到 Queen 本人（一首叫 Queen 的日文歌排在前面），
/// 搜「Perfume」撈到 0 首本人；改用 lookup 之後兩個都是 60 首。
///
/// **id 是怎麼來的**：跑一次解析（Search 的 entity=musicArtist），規則是
///   ① 精確吻合裡恰好一個曲風對得上這個語種 → 取它
///   ② 還是多個 → 取 Apple 排序第一（實測十個歧義案例九個第一名就是對的）
///   ③ 沒有精確吻合 → 只在第一候選曲風對得上時才收（Apple 改了名字的情況）
///   ④ 都不成立 → **跳過，不猜**
/// 296 位裡 288 位自動解析出來；剩下 8 位的曲風對應不到語種（搖滾／流行樂／
/// 另類／嘻哈都不帶語言資訊），一個一個看過候選清單之後手動補在各語種的最前面。
///
/// 要加人：把名字丟進解析腳本（tools/SongQuiz.BankBuilder 裡的 resolve.mjs），
/// 或者手動去 music.apple.com 找那位歌手的頁面，網址最後那串數字就是 id。
/// </remarks>
public sealed record ClassicArtist(string Name, long ArtistId);

public static class Artists
{
    public static readonly IReadOnlyDictionary<Language, ClassicArtist[]> ByLanguage
        = new Dictionary<Language, ClassicArtist[]>
    {
        [Language.Mandarin] =
        [
            // 手動補的：Apple 給的曲風是搖滾／流行樂／另類／嘻哈，對應不到語種，
            // 所以自動解析會跳過它們。id 是一個一個看過候選清單挑的。
            new("高爾宣", 1095881981),
            new("張震嶽", 369289818), new("張信哲", 14619979), new("劉德華", 19345683),
            new("張雨生", 202968045), new("任賢齊", 368372834), new("彭佳慧", 690432144),
            new("鄧麗君", 137320901), new("5566", 255921846), new("小虎隊", 751896013),
            new("棒棒堂", 15132680), new("周傳雄", 41867774), new("黃小琥", 367991488),
            new("陳小春", 656087484), new("庾澄慶", 306466690), new("蕭敬騰", 283971013),
            new("飛兒樂團", 205561210), new("范逸臣", 681251699), new("方大同", 201549024),
            new("王藍茵", 408651913), new("MP魔幻力量", 368191060), new("By2", 265595963),
            new("潘瑋柏", 260955153), new("張韶涵", 535400872), new("王心凌", 347815083),
            new("張惠妹", 422255649), new("李榮浩", 307674970), new("李玟", 15772775),
            new("林宥嘉", 436847316), new("楊宗緯", 466427122), new("李浩瑋", 1441098132),
            new("謝和弦", 420372665), new("黃明志", 600866763), new("叮噹", 453466412),
            new("梁文音", 303214431), new("周湯豪", 911092195), new("家家", 295060477),
            new("陳芳語", 520340425), new("陳勢安", 156423522), new("李聖傑", 735931601),
            new("吳克群", 400171473), new("李佳薇", 211566950), new("李玖哲", 289040110),
            new("黃鴻升", 543460036), new("周興哲", 903273139), new("周深", 1154054707),
            new("華晨宇", 919255386), new("汪蘇瀧", 657686835), new("張碧晨", 1019445030),
            new("張靚穎", 276363061), new("鄧福如", 658116631), new("蔡健雅", 387313548),
            new("胡夏", 408937662), new("薛之謙", 160809474), new("胡彥斌", 29431462),
            new("周杰倫", 300117743), new("五月天", 369211611), new("蔡依林", 152678183),
            new("林俊傑", 216635866), new("田馥甄", 417691809), new("告五人", 1284151651),
            new("鄧紫棋", 425208570), new("孫燕姿", 83405200), new("韋禮安", 441921723),
            new("陳奕迅", 137938148), new("蘇打綠", 345954909), new("盧廣仲", 477669285),
            new("徐佳瑩", 387317532), new("八三夭", 904192340), new("魏如萱", 426913195),
            new("楊丞琳", 299846702), new("動力火車", 593436026), new("張學友", 256718696),
            new("王菲", 41760704), new("莫文蔚", 162585630), new("梁靜茹", 531134701),
            new("劉若英", 16027938), new("信樂團", 820255331), new("王力宏", 117741179),
            new("蕭亞軒", 14892084), new("光良", 152368592), new("品冠", 368373220),
            new("曹格", 513448219), new("范瑋琪", 287299102), new("Tank", 1705928399),
            new("F4", 137635396), new("自由發揮", 407647121), new("郁可唯", 369227516),
            new("畢書盡", 449081841), new("S.H.E", 104129527), new("陶喆", 16789930),
            new("A-Lin", 370412270),
        ],

        [Language.Taiwanese] =
        [
            new("張清芳", 762342228), new("曾心梅", 568796353), new("施文彬", 449590536),
            new("葉啟田", 382303919), new("沈文程", 1105496867), new("伍佰", 327469111),
            new("茄子蛋", 1416696196), new("江蕙", 395158183), new("蕭煌奇", 441717593),
            new("滅火器", 850327761), new("謝金燕", 406292125), new("黃乙玲", 404105101),
            new("鄭進一", 609425209), new("玖壹壹", 935194104), new("洪榮宏", 417429273),
            new("陳一郎", 471754383), new("陳小雲", 371217500), new("林強", 380626237),
            new("潘越雲", 152297993), new("蔡秋鳳", 370358592), new("張秀卿", 718073088),
            new("方瑞娥", 1021190013), new("龍千玉", 976090098), new("詹雅雯", 781295482),
            new("白冰冰", 417449489), new("陳雷", 158043233), new("小鳳鳳", 787040114),
            new("向蕙玲", 976075090), new("康康", 292009859), new("翁立友", 976085673),
        ],

        [Language.Western] =
        [
            // 手動補的：Apple 給的曲風是搖滾／流行樂／另類／嘻哈，對應不到語種，
            // 所以自動解析會跳過它們。id 是一個一個看過候選清單挑的。
            new("Céline Dion", 63729),
            new("OneRepublic", 260414340), new("Ava Max", 1265164818), new("Nicki Minaj", 278464538),
            new("Dua Lipa", 1031397873), new("Iggy Azalea", 503970811), new("Little Mix", 477515548),
            new("One Direction", 396754057), new("Selena Gomez", 280215834), new("Marshmello", 980795202),
            new("Christina Perri", 378346343), new("Bebe Rexha", 466059563), new("Arctic Monkeys", 62820413),
            new("Owl City", 264481094), new("Evanescence", 42102393), new("Fall Out Boy", 28673423),
            new("JAY-Z", 1525651974), new("Meghan Trainor", 348580754), new("Miley Cyrus", 137057909),
            new("Taylor Swift", 159260351), new("Bruno Mars", 278873078), new("Billie Eilish", 1065981054),
            new("Maroon 5", 1798556), new("Coldplay", 471744), new("Ariana Grande", 412778295),
            new("Charlie Puth", 336249253), new("Katy Perry", 64387566), new("Whitney Houston", 13952),
            new("Mariah Carey", 91853), new("Backstreet Boys", 217039), new("Westlife", 807028),
            new("Queen", 3296287), new("Britney Spears", 217005), new("Avril Lavigne", 459885),
            new("Beyoncé", 1419227), new("Black Eyed Peas", 360391), new("Linkin Park", 148662),
            new("Lady Gaga", 277293880), new("Jason Mraz", 156987), new("Shawn Mendes", 890403665),
            new("Imagine Dragons", 358714030), new("Justin Bieber", 320569549), new("Olivia Rodrigo", 979458609),
            new("Harry Styles", 471260289), new("Doja Cat", 830588310), new("Sabrina Carpenter", 390647681),
            new("Pitbull", 27044968), new("Kesha", 334854763), new("Alan Walker", 1062085272),
            new("Sam Smith", 156488786), new("Sia", 28721078), new("The Weeknd", 479756766),
            new("P!nk", 4488522), new("Shakira", 889327), new("NSYNC", 398120),
            new("Halsey", 324916925), new("Eminem", 111051), new("Jessie J", 405360400),
            new("Lauv", 982612996), new("Lewis Capaldi", 1213405916), new("Justin Timberlake", 398128),
            new("Madonna", 20044), new("Ed Sheeran", 183313439), new("Adele", 262836961),
            new("Michael Jackson", 32940), new("Bon Jovi", 122782), new("Rihanna", 63346553),
        ],

        [Language.Korean] =
        [
            // 手動補的：Apple 給的曲風是搖滾／流行樂／另類／嘻哈，對應不到語種，
            // 所以自動解析會跳過它們。id 是一個一個看過候選清單挑的。
            new("東方神起", 540125745),
            new("BIGBANG", 318754656), new("少女時代", 357463500), new("Wonder Girls", 289029151),
            new("SUPER JUNIOR", 284066214), new("2NE1", 329155759), new("4Minute", 371898647),
            new("T-ARA", 471900661), new("Girl's Day", 429348919), new("SISTAR", 380432623),
            new("AOA", 1080563762), new("BTOB", 515372357), new("EXO", 657630070),
            new("EXID", 503473013), new("AKMU", 747306596), new("MAMAMOO", 818951094),
            new("GOT7", 802694659), new("Red Velvet", 906961899), new("GFRIEND", 958416186),
            new("WJSN", 1087651007), new("I.O.I", 1110816583), new("NCT 127", 1235849306),
            new("Wanna One", 1268507013), new("IZ*ONE", 1440449616), new("SEVENTEEN", 999644772),
            new("TOMORROW X TOGETHER", 1454642552), new("ENHYPEN", 1541011620), new("NMIXX", 1600411676),
            new("NewJeans", 1635469693), new("LE SSERAFIM", 1616740364), new("Kep1er", 1594156263),
            new("RIIZE", 1702435257), new("KiiiKiii", 1795471746), new("Hearts2Hearts", 1793698498),
            new("HyunA", 384855556), new("BTS", 883131348), new("BLACKPINK", 1141774019),
            new("aespa", 1540251304), new("(G)I-DLE", 1378887586), new("H.O.T.", 4691436),
            new("SHINee", 433371033), new("f(x)", 425076892), new("miss A", 312076995),
            new("Apink", 482854746), new("Trouble Maker", 214830950), new("WINNER", 908222845),
            new("CLC", 978594123), new("iKON", 1044506362), new("TWICE", 1203816887),
            new("ATEEZ", 1439301205), new("ITZY", 1451964345), new("IVE", 1594159996),
            new("KISS OF LIFE", 1694672936), new("MEOVV", 1765256889), new("ILLIT", 1734551937),
            new("KATSEYE", 1754284416), new("IU", 409076743), new("Stray Kids", 1304823362),
            new("CORTIS", 1831651635),
        ],

        [Language.Japanese] =
        [
            // 手動補的：Apple 給的曲風是搖滾／流行樂／另類／嘻哈，對應不到語種，
            // 所以自動解析會跳過它們。id 是一個一個看過候選清單挑的。
            new("LiSA", 573943518), new("女王蜂", 419045160), new("優里", 1489331027), new("藤井風", 1486113150), new("ヨルシカ", 1250709916),
            new("いきものがかり", 550412714), new("imase", 1598758503), new("Mrs. GREEN APPLE", 962221033),
            new("緑黄色社会", 747734869), new("澤野弘之", 912316913), new("藍井エイル", 569938402),
            new("スピッツ", 74456960), new("BUMP OF CHICKEN", 185088141), new("宮脇詩音", 259912603),
            new("YOASOBI", 1490256993), new("米津玄師", 530814268), new("Official髭男dism", 960568308),
            new("星野源", 269598403), new("あいみょん", 1165017710), new("RADWIMPS", 91160335),
            new("King Gnu", 1258439196), new("宇多田ヒカル", 18756224), new("Mr.Children", 428909573),
            new("安室奈美恵", 74068261), new("浜崎あゆみ", 73951471), new("中島美嘉", 292677928),
            new("西野カナ", 410542403), new("back number", 302361237), new("SEKAI NO OWARI", 454694621),
            new("Vaundy", 1487570516), new("Creepy Nuts", 678140651), new("水樹奈々", 308629932),
            new("milet", 880638079), new("ano", 1529999013), new("yama", 1506180365),
            new("Uru", 1124533435), new("AAA", 79789358), new("michi", 422230049),
            new("Perfume", 351343399), new("ZARD", 74945708), new("GLAY", 705683182),
            new("B'z", 74931253), new("L'Arc-en-Ciel", 80486557), new("ONE OK ROCK", 252239625),
            new("Ado", 1492604670), new("Aimer", 569972619), new("Eve", 1080967231),
            new("ClariS", 548139430),
        ],

    };

    /// <summary>
    /// 解析不出 id、因此沒有進名單的人。留著是為了下次有人問「怎麼沒有某某」。
    /// </summary>
    /// <remarks>
    /// mandarin／高爾宣：第一候選是「高爾宣 OSN／嘻哈/饒舌」，曲風對不上
    /// western／Celine Dion：第一候選是「Céline Dion／流行樂」，曲風對不上
    /// japanese／女王蜂：第一候選是「QUEEN BEE／搖滾」，曲風對不上
    /// japanese／優里：第一候選是「Yuuri／搖滾」，曲風對不上
    /// japanese／藤井風：第一候選是「Fujii Kaze／流行樂」，曲風對不上
    /// japanese／ヨルシカ：第一候選是「Yorushika／另類音樂」，曲風對不上
    /// japanese／LiSA：同名的人太多（動畫 LiSA／BLACKPINK LISA／R&B Lisa），照約定跳過不猜
    /// korean／東方神起：第一候選是「TVXQ!／流行樂」，曲風對不上
    /// </remarks>
    public const int SkippedCount = 8;
}
