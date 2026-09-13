namespace SongQuiz.Common;

/// <summary>
/// 時間來源。計分要用「伺服器覺得過了幾秒」，所以時鐘必須可以被測試替換掉，
/// 不能在計分邏輯裡直接寫 DateTime.UtcNow。
/// </summary>
public interface IClock
{
    DateTimeOffset UtcNow { get; }
}

/// <summary>正式環境用的時鐘。</summary>
public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

/// <summary>測試用：時間只在你叫它走的時候才走。</summary>
public sealed class FakeClock(DateTimeOffset start) : IClock
{
    public DateTimeOffset UtcNow { get; private set; } = start;

    public void Advance(TimeSpan span) => UtcNow += span;
}
