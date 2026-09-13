namespace SongQuiz.Quiz;

/// <summary>一個選項。前端只認得 <paramref name="Id"/>，不知道哪個是對的。</summary>
/// <param name="Id">這一題之內的臨時編號。</param>
/// <param name="Label">顯示文字。</param>
public sealed record Choice(int Id, string Label);

/// <summary>
/// 一道題。<paramref name="AnswerId"/> 絕對不能送到前端去——
/// 答案是在伺服器判的，前端只會在答完之後才知道正解是哪一個。
/// </summary>
public sealed record Question(
    Track Answer,
    IReadOnlyList<Choice> Choices,
    int AnswerId);
