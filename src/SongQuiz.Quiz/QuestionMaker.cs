using SongQuiz.Common;

namespace SongQuiz.Quiz;

/// <summary>
/// 出題器：挑一首歌當答案，再湊足九個看起來一樣合理的選項。
/// </summary>
/// <remarks>
/// 錯誤選項的兩條規則，都是為了堵同一個漏洞——「用排除法猜」：
/// 一、錯誤選項必須和答案同語種，否則一題裡混進兩首韓文歌就等於送分；
/// 二、誘餌庫（不會被出題的歌名）要一起參與，否則玩久了會發現
///     「出現過的選項才可能是答案」。
/// </remarks>
public sealed class QuestionMaker(SongBank bank)
{
    /// <summary>每題幾個選項。</summary>
    public const int ChoiceCount = 9;

    /// <summary>
    /// 從 <paramref name="languages"/> 允許的語種裡出一題，避開 <paramref name="usedTrackIds"/>。
    /// 題庫湊不出一題時回 null，由呼叫方決定要縮小條件還是結束遊戲。
    /// </summary>
    public Question? Next(
        IReadOnlyCollection<Language> languages,
        ISet<long> usedTrackIds,
        Random random,
        Language? mustBe = null)
    {
        var pool = bank.Tracks
            .Where(t => languages.Contains(t.Language))
            .Where(t => !usedTrackIds.Contains(t.Id))
            .Where(t => mustBe is null || t.Language == mustBe)
            .ToList();

        if (pool.Count == 0) return null;

        var answer = pool[random.Next(pool.Count)];
        var labels = BuildWrongLabels(answer, random);

        labels.Add(answer.Label);
        labels.Shuffle(random);

        var choices = labels.Select((label, i) => new Choice(i, label)).ToList();
        var answerId = choices.First(c => c.Label == answer.Label).Id;

        return new Question(answer, choices, answerId);
    }

    /// <summary>
    /// 湊出八個錯誤選項：同語種的真歌優先，不足再拿同語種誘餌補，
    /// 還是不足才放寬到其他語種——寧可干擾力差一點，也不要選項數量忽多忽少。
    /// </summary>
    private List<string> BuildWrongLabels(Track answer, Random random)
    {
        var taken = new HashSet<string> { answer.Label };
        var wanted = ChoiceCount - 1;
        var wrong = new List<string>();

        void Fill(IEnumerable<string> candidates)
        {
            foreach (var label in candidates.ToList().Also(l => l.Shuffle(random)))
            {
                if (wrong.Count == wanted) return;
                if (taken.Add(label)) wrong.Add(label);
            }
        }

        Fill(bank.Tracks.Where(t => t.Language == answer.Language && t.Id != answer.Id).Select(t => t.Label));
        Fill(bank.Decoys.Where(d => d.Language == answer.Language).Select(d => d.Label));
        Fill(bank.Tracks.Where(t => t.Id != answer.Id).Select(t => t.Label));
        Fill(bank.Decoys.Select(d => d.Label));

        return wrong;
    }
}

internal static class PipeExtensions
{
    /// <summary>就地做一件事再把自己傳回去，讓上面的 Fill() 讀起來是一條線。</summary>
    internal static T Also<T>(this T self, Action<T> act)
    {
        act(self);
        return self;
    }
}
