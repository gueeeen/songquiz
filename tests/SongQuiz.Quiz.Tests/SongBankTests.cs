using SongQuiz.Quiz;

namespace SongQuiz.Quiz.Tests;

public class SongBankTests
{
    [Fact]
    public void 題庫檔不存在時回空題庫而不是炸掉()
    {
        var bank = SongBank.LoadOrEmpty(Path.Combine(Path.GetTempPath(), "沒有這個檔.json"));

        Assert.True(bank.IsEmpty);
        Assert.Empty(bank.Tracks);
    }

    [Fact]
    public void 存檔再讀回來內容一致()
    {
        var path = Path.Combine(Path.GetTempPath(), $"bank-{Guid.NewGuid():n}.json");
        var original = new SongBank
        {
            Tracks =
            [
                new Track(1, "晴天", "周杰倫", Language.Mandarin, "https://example.test/1.m4a"),
                new Track(2, "浪流連", "茄子蛋", Language.Taiwanese, "https://example.test/2.m4a"),
            ],
            Decoys = [new Decoy("稻香", "周杰倫", Language.Mandarin)],
        };

        try
        {
            original.Save(path);
            var loaded = SongBank.LoadOrEmpty(path);

            Assert.Equal(original.Tracks, loaded.Tracks);
            Assert.Equal(original.Decoys, loaded.Decoys);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void 沒有試聽網址的歌讀進來會被丟掉()
    {
        // 沒有音檔就出不了題。讓它留在題庫裡只會變成「播不出聲音」的題目。
        var path = Path.Combine(Path.GetTempPath(), $"bank-{Guid.NewGuid():n}.json");
        File.WriteAllText(path, """
        {
          "generatedAt": "2026-01-01T00:00:00+00:00",
          "tracks": [
            { "id": 1, "title": "有音檔", "artist": "甲", "language": "mandarin", "previewUrl": "https://example.test/1.m4a" },
            { "id": 2, "title": "沒音檔", "artist": "乙", "language": "mandarin", "previewUrl": "" }
          ],
          "decoys": []
        }
        """);

        try
        {
            var bank = SongBank.LoadOrEmpty(path);

            Assert.Single(bank.Tracks);
            Assert.Equal("有音檔", bank.Tracks[0].Title);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void 語種統計數得對()
    {
        var bank = new SongBank
        {
            Tracks =
            [
                new Track(1, "a", "甲", Language.Mandarin, "u"),
                new Track(2, "b", "乙", Language.Mandarin, "u"),
                new Track(3, "c", "丙", Language.Korean, "u"),
            ],
            Decoys = [],
        };

        Assert.Equal(2, bank.Census()[Language.Mandarin]);
        Assert.Equal(3, bank.CountOf([Language.Mandarin, Language.Korean]));
        Assert.Equal(0, bank.CountOf([Language.Japanese]));
    }
}
