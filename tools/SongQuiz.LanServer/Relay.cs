using System.Net.WebSockets;

namespace SongQuiz.LanServer;

/// <summary>
/// 房間登記簿：哪一個房號上面掛著哪些連線。
/// </summary>
/// <remarks>
/// <para>
/// <b>這裡沒有一行遊戲邏輯，而且要一直維持這樣。</b>
/// 中繼只認得「房號」和「一包位元組」，不知道 hello／roster／claim 是什麼意思，
/// 不判誰先答對、不算分、不存任何東西。裁判仍然是房主那一頁（room.js 的 arbitrate）。
/// </para>
/// <para>
/// 為什麼要守住這條線：中繼一旦開始「懂」遊戲，它就變成第二個遊戲規則實作，
/// 從此每次改規則都要記得改兩個地方——而且這一個還是用另一種語言寫的，
/// 忘了改也不會有人發現，只會在朋友面前算錯分。
/// 它就是一根水管，水裡是什麼不歸它管。
/// </para>
/// </remarks>
public sealed class Relay
{
    /// <summary>
    /// 一把大鎖管住整張表。房間數與人數都是個位數，拆細鎖省不到東西，
    /// 反而多出「加人的同時房間剛好被清掉」這種競態要想。
    /// </summary>
    private readonly object _gate = new();

    private readonly Dictionary<string, Dictionary<long, Peer>> _rooms = new(StringComparer.Ordinal);

    private long _nextPeerId;

    /// <summary>現在有幾間房（只給啟動訊息與診斷用）。</summary>
    public int RoomCount
    {
        get { lock (_gate) return _rooms.Count; }
    }

    /// <summary>把一條連線掛進房間，回傳它在這間房裡的身分。</summary>
    public Peer Join(string room, WebSocket socket)
    {
        lock (_gate)
        {
            if (!_rooms.TryGetValue(room, out var peers))
            {
                peers = [];
                _rooms[room] = peers;
            }

            var peer = new Peer(Interlocked.Increment(ref _nextPeerId), socket);
            peers[peer.Id] = peer;
            return peer;
        }
    }

    /// <summary>
    /// 連線結束時把人拿掉；房間空了就整間刪除。
    /// 不刪的話這張表只會長不會縮——一個晚上玩十場就留十間空房在記憶體裡，
    /// 而空房永遠不會再有人回來（房號是每次建房現抽的）。
    /// </summary>
    public void Leave(string room, Peer peer)
    {
        lock (_gate)
        {
            if (!_rooms.TryGetValue(room, out var peers)) return;

            peers.Remove(peer.Id);
            if (peers.Count == 0) _rooms.Remove(room);
        }
    }

    /// <summary>
    /// 同一間房裡「除了他自己以外」的連線。
    /// 不回送給發送者本人是既有 adapter 介面的契約（見 web/js/realtime.js 開頭）：
    /// BroadcastChannel 規格上就不派送給發送端，Supabase 的 broadcast 預設 self:false，
    /// 呼叫端因此假設自己的動作要自己先套用。這條水管不能破例。
    /// </summary>
    public Peer[] Others(string room, Peer peer)
    {
        lock (_gate)
        {
            if (!_rooms.TryGetValue(room, out var peers) || peers.Count < 2) return [];

            var others = new List<Peer>(peers.Count - 1);
            foreach (var candidate in peers.Values)
            {
                if (candidate.Id != peer.Id) others.Add(candidate);
            }

            return [.. others];
        }
    }
}

/// <summary>房間裡的一條連線。</summary>
public sealed class Peer(long id, WebSocket socket)
{
    /// <summary>這條連線在中繼裡的編號。跟玩家的 selfId 沒有關係——中繼不看封包內容。</summary>
    public long Id { get; } = id;

    public WebSocket Socket { get; } = socket;

    /// <summary>
    /// 同一個 WebSocket 不能有兩個 SendAsync 同時進行（規格如此，違反會壞掉整條連線）。
    /// 三個人同時搶答就會有三則訊息要轉給同一個房主，所以這把鎖是必要的，不是保險。
    /// </summary>
    private readonly SemaphoreSlim _sendGate = new(1, 1);

    /// <summary>
    /// 原封不動轉一包出去。轉不出去（對方剛好斷線）就算了：
    /// 一個人的網路斷掉不能連累同一間房的其他人，那條連線自己的迴圈會收拾它。
    /// </summary>
    public async Task TryForwardAsync(ReadOnlyMemory<byte> payload, WebSocketMessageType type, CancellationToken cancel)
    {
        if (Socket.State != WebSocketState.Open) return;

        try
        {
            await _sendGate.WaitAsync(cancel).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        try
        {
            if (Socket.State == WebSocketState.Open)
            {
                await Socket.SendAsync(payload, type, endOfMessage: true, cancel).ConfigureAwait(false);
            }
        }
        catch (Exception)
        {
            // WebSocketException／ObjectDisposedException／OperationCanceledException 都是同一件事：
            // 這個人已經不在了。伺服器不能因為某個玩家關分頁就掛掉。
        }
        finally
        {
            _sendGate.Release();
        }
    }
}
