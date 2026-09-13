using System.Collections.Concurrent;
using SongQuiz.Common;
using SongQuiz.Game;
using SongQuiz.Quiz;

namespace SongQuiz.Server;

/// <summary>
/// 進行中的對局。放記憶體就好——這是社團擺攤用的遊戲，
/// 一場三分鐘，伺服器重開就重玩，沒有必要為它架資料庫。
/// </summary>
public sealed class SessionStore(SongBank bank, IClock clock)
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(2);

    private readonly ConcurrentDictionary<string, Entry> _sessions = new();

    public SongBank Bank { get; } = bank;

    public GameSession Create(GameMode mode)
    {
        Sweep();
        var id = Guid.NewGuid().ToString("n")[..12];
        var session = new GameSession(id, mode, Bank, clock, Random.Shared);
        _sessions[id] = new Entry(session, clock.UtcNow);
        return session;
    }

    /// <summary>取對局；找不到（或已過期）回 null，讓前端顯示「這場已經結束了」。</summary>
    public GameSession? Find(string id)
    {
        if (!_sessions.TryGetValue(id, out var entry)) return null;
        _sessions[id] = entry with { Touched = clock.UtcNow };
        return entry.Session;
    }

    /// <summary>清掉沒人再碰的對局，免得擺攤一整天記憶體一直長。</summary>
    private void Sweep()
    {
        var deadline = clock.UtcNow - Lifetime;
        foreach (var (id, entry) in _sessions)
            if (entry.Touched < deadline)
                _sessions.TryRemove(id, out _);
    }

    private sealed record Entry(GameSession Session, DateTimeOffset Touched);
}
