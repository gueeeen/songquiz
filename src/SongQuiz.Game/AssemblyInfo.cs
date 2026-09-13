using System.Runtime.CompilerServices;

// 測試要驗「這一題的正解是哪個編號」，而正解刻意不在公開介面上——
// 它連 QuestionView 都不進去，否則前端就拿得到答案了。
// 所以答案只開給測試專案，不開給任何會被前端碰到的東西。
[assembly: InternalsVisibleTo("SongQuiz.Game.Tests")]
