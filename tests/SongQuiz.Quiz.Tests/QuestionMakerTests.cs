using SongQuiz.Quiz;

namespace SongQuiz.Quiz.Tests;

public class QuestionMakerTests
{
    /// <summary>做一個指定語種數量的假題庫。</summary>
    private static SongBank BankOf(params (Language Language, int Count)[] spec)
    {
        var tracks = new List<Track>();
        var id = 1L;
        foreach (var (language, count) in spec)
            for (var i = 0; i < count; i++)
                tracks.Add(new Track(id++, $"{language}-歌{i}", $"{language}-歌手{i}", language,
                    $"https://example.test/{language}/{i}.m4a"));

        var decoys = Enumerable.Range(0, 30)
            .Select(i => new Decoy($"誘餌{i}", $"誘餌歌手{i}", Language.Mandarin))
            .ToList();

        return new SongBank { Tracks = tracks, Decoys = decoys };
    }

    [Fact]
    public void 一題永遠是九個選項()
    {
        var maker = new QuestionMaker(BankOf((Language.Mandarin, 20)));

        var question = maker.Next([Language.Mandarin], new HashSet<long>(), new Random(1));

        Assert.NotNull(question);
        Assert.Equal(QuestionMaker.ChoiceCount, question.Choices.Count);
    }

    [Fact]
    public void 選項不重複且恰好有一個正解()
    {
        var maker = new QuestionMaker(BankOf((Language.Mandarin, 20)));

        var question = maker.Next([Language.Mandarin], new HashSet<long>(), new Random(7))!;

        Assert.Equal(question.Choices.Count, question.Choices.Select(c => c.Label).Distinct().Count());
        Assert.Single(question.Choices.Where(c => c.Label == question.Answer.Label));
        Assert.Equal(question.Answer.Label, question.Choices.Single(c => c.Id == question.AnswerId).Label);
    }

    [Fact]
    public void 題庫只剩三首也要湊滿九個選項()
    {
        // 誘餌的存在意義就在這裡：歌少的時候選項數量不能縮水，
        // 否則玩家看選項多寡就知道這題出自哪個池子。
        var maker = new QuestionMaker(BankOf((Language.Mandarin, 3)));

        var question = maker.Next([Language.Mandarin], new HashSet<long>(), new Random(3))!;

        Assert.Equal(QuestionMaker.ChoiceCount, question.Choices.Count);
    }

    [Fact]
    public void 不會出已經聽過的歌()
    {
        var bank = BankOf((Language.Mandarin, 4));
        var maker = new QuestionMaker(bank);
        var used = new HashSet<long>();

        for (var i = 0; i < 4; i++)
        {
            var question = maker.Next([Language.Mandarin], used, new Random(i));
            Assert.NotNull(question);
            Assert.True(used.Add(question.Answer.Id), "同一首歌被出了第二次");
        }

        Assert.Null(maker.Next([Language.Mandarin], used, new Random(9)));
    }

    [Fact]
    public void 只出允許語種的歌()
    {
        var maker = new QuestionMaker(BankOf((Language.Mandarin, 10), (Language.Japanese, 10)));

        for (var seed = 0; seed < 20; seed++)
        {
            var question = maker.Next([Language.Mandarin], new HashSet<long>(), new Random(seed))!;
            Assert.Equal(Language.Mandarin, question.Answer.Language);
        }
    }

    [Fact]
    public void 指定語種時答案就是那個語種()
    {
        var maker = new QuestionMaker(BankOf((Language.Mandarin, 10), (Language.Taiwanese, 10)));

        var question = maker.Next(
            [Language.Mandarin, Language.Taiwanese],
            new HashSet<long>(),
            new Random(5),
            mustBe: Language.Taiwanese)!;

        Assert.Equal(Language.Taiwanese, question.Answer.Language);
    }

    [Fact]
    public void 同一顆種子出一樣的題()
    {
        var maker = new QuestionMaker(BankOf((Language.Mandarin, 20)));

        var a = maker.Next([Language.Mandarin], new HashSet<long>(), new Random(42))!;
        var b = maker.Next([Language.Mandarin], new HashSet<long>(), new Random(42))!;

        Assert.Equal(a.Answer.Id, b.Answer.Id);
        Assert.Equal(a.Choices.Select(c => c.Label), b.Choices.Select(c => c.Label));
    }
}
