using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace SongQuiz.LanServer;

/// <summary>這台電腦在區域網路上的位址。啟動時要印出來念給朋友聽。</summary>
public static class LocalAddresses
{
    /// <summary>一張網卡上的一個位址。</summary>
    public readonly record struct Entry(string Adapter, IPAddress Address);

    /// <summary>
    /// 挑出「朋友的手機打得到」的 IPv4 位址。
    /// </summary>
    /// <remarks>
    /// <para>
    /// 為什麼全部印出來而不是自己挑一個最好的：一台筆電同時有 Wi-Fi、有線、
    /// 還可能有 WSL／Hyper-V／VPN 的虛擬網卡，從伺服器這邊看它們長得一模一樣
    /// （都是 Up、都有私有網段的位址），程式沒有辦法知道朋友的手機接在哪一個上面。
    /// 猜錯的代價是「網址打不開，而且不知道為什麼」；全部印出來讓人自己試，
    /// 最多多試一次就中了。
    /// </para>
    /// <para>
    /// 濾掉的三種：回送介面（127.0.0.1 只有自己打得到）、通道介面（VPN 之類，
    /// 那一頭不是這個場地），以及 169.254.x.x 這種 DHCP 沒拿到位址時自己編的。
    /// IPv6 也不印：現場是一個 Wi-Fi 分享器，IPv4 一定通，
    /// 而 IPv6 位址又長又難念，貼上去只是噪音。
    /// </para>
    /// </remarks>
    public static IReadOnlyList<Entry> LanIPv4()
    {
        var found = new List<Entry>();

        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up) continue;
            if (nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;

            foreach (var unicast in nic.GetIPProperties().UnicastAddresses)
            {
                if (unicast.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                if (IPAddress.IsLoopback(unicast.Address)) continue;

                var bytes = unicast.Address.GetAddressBytes();
                if (bytes[0] == 169 && bytes[1] == 254) continue;

                found.Add(new Entry(nic.Name, unicast.Address));
            }
        }

        // 無線排前面：朋友在現場用手機連的，九成是同一個 Wi-Fi。
        return [.. found.OrderByDescending(e => IsWireless(e.Adapter))];
    }

    private static bool IsWireless(string adapter) =>
        adapter.Contains("Wi-Fi", StringComparison.OrdinalIgnoreCase)
        || adapter.Contains("WLAN", StringComparison.OrdinalIgnoreCase)
        || adapter.Contains("Wireless", StringComparison.OrdinalIgnoreCase)
        || adapter.Contains("無線", StringComparison.Ordinal);
}
