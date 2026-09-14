using System.Net.WebSockets;
using System.Text;

namespace SongQuiz.LanServer;

/// <summary>
/// 一條 WebSocket 的生命週期：收一包、轉給同房的其他人、重複，直到斷線。
/// </summary>
public static class RoomSocket
{
    /// <summary>
    /// 單則訊息的上限。房間最大的一則是 start（設定＋種子）與 roster（名冊），
    /// 都遠遠不到 64 KB；留這個上限是為了「有人拿這條連線亂丟東西」時，
    /// 記憶體不會被一則沒有結尾的訊息吃光。
    /// </summary>
    private const int MaxMessageBytes = 256 * 1024;

    /// <summary>一次 ReceiveAsync 的緩衝。訊息比這個大就會分好幾次收，迴圈自己會接起來。</summary>
    private const int ChunkBytes = 8 * 1024;

    /// <summary>
    /// 轉一則訊息給某個人的等待上限。同一個 Wi-Fi 下這是毫秒等級的事，
    /// 這個上限是給「手機已經走出訊號範圍、TCP 還沒發現」的那種半死連線用的——
    /// 沒有上限的話，一個人走到電梯裡就會讓整間房卡住。
    /// </summary>
    private static readonly TimeSpan ForwardTimeout = TimeSpan.FromSeconds(5);

    /// <summary>
    /// 把房號整理成一個安全的字典鍵。
    /// </summary>
    /// <remarks>
    /// 這裡刻意<b>不</b>照抄 realtime.js 的房號字母表。中繼不該知道遊戲怎麼產房號——
    /// 哪天房號改成六碼或換一套字母，中繼不必跟著改。
    /// 它只需要保證這個字串當字典鍵是安全的：長度有限、字元單純、大小寫一致
    /// （房號是喊給人聽的，手機鍵盤可能自動變小寫）。
    /// </remarks>
    public static string? NormalizeRoom(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        var builder = new StringBuilder(16);
        foreach (var ch in raw.ToUpperInvariant())
        {
            if (ch is (>= 'A' and <= 'Z') or (>= '0' and <= '9')) builder.Append(ch);
            if (builder.Length == 16) break;
        }

        return builder.Length == 0 ? null : builder.ToString();
    }

    /// <summary>
    /// 收 → 轉，直到對方走了。
    /// </summary>
    /// <remarks>
    /// <b>整段不解析內容。</b>收到什麼位元組就轉什麼位元組，連 JSON 都不剖。
    /// 這樣房間協定（web/js/realtime.js 的 envelope）改版時，中繼一個字都不用動。
    /// </remarks>
    public static async Task PumpAsync(Relay relay, string room, Peer peer, ILogger logger, CancellationToken stopping)
    {
        var chunk = new byte[ChunkBytes];
        using var message = new MemoryStream(ChunkBytes);

        while (!stopping.IsCancellationRequested && peer.Socket.State == WebSocketState.Open)
        {
            WebSocketReceiveResult received;

            try
            {
                received = await peer.Socket.ReceiveAsync(new ArraySegment<byte>(chunk), stopping).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (WebSocketException)
            {
                // 對方直接消失（關分頁、手機鎖屏、Wi-Fi 掉了）。這是正常結束，不是錯誤。
                break;
            }

            if (received.MessageType == WebSocketMessageType.Close) break;

            message.Write(chunk, 0, received.Count);

            if (message.Length > MaxMessageBytes)
            {
                logger.LogWarning("房間 {Room} 有一則訊息超過 {Limit} 位元組，切斷這條連線。", room, MaxMessageBytes);
                break;
            }

            // 一則訊息可能分好幾段到，沒收完就不要轉——轉半則出去，
            // 對方的 JSON.parse 會炸，而且看起來會像是房間協定有問題。
            if (!received.EndOfMessage) continue;

            var payload = message.ToArray();
            message.SetLength(0);

            var others = relay.Others(room, peer);
            if (others.Length == 0) continue;

            // 轉送刻意**不**跟著發送者的 RequestAborted 走。
            // 訊息已經完整收下來了，這時候發送者關掉分頁（房主廣播完 award 就離開、
            // 或有人送完 bye 就走）不該讓同一則訊息在半路被取消——收件人還在等。
            // 取而代之的是一個自己的逾時：轉不出去的對象就跳過，不要卡住整間房。
            using var deadline = new CancellationTokenSource(ForwardTimeout);

            var forwards = new Task[others.Length];
            for (var i = 0; i < others.Length; i++)
            {
                forwards[i] = others[i].TryForwardAsync(payload, received.MessageType, deadline.Token);
            }

            await Task.WhenAll(forwards).ConfigureAwait(false);
        }

        await CloseQuietlyAsync(peer.Socket).ConfigureAwait(false);
    }

    /// <summary>
    /// 收工時禮貌地關一下。關不成就算了：走到這裡連線本來就已經沒救了，
    /// 這時再丟例外只會讓真正的結束流程（把人從房間拿掉）跑不完。
    /// </summary>
    private static async Task CloseQuietlyAsync(WebSocket socket)
    {
        try
        {
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, timeout.Token).ConfigureAwait(false);
            }
        }
        catch (Exception)
        {
            // 同上：關的時候出錯沒有下一步可做。
        }
    }
}
