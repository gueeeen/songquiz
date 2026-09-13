@echo off
chcp 65001 >nul
title 重建題庫
cd /d "%~dp0"

echo.
echo   要向 Apple 的公開 Search API 查歌，需要網路。
echo   會循序送出大約 64 個請求、每次間隔 400 毫秒，大概一分鐘。
echo.

dotnet build "SongQuiz.sln" -c Debug -v quiet --nologo
if errorlevel 1 (
    echo   建置失敗。把上面的錯誤訊息貼給 Claude 看。
    pause
    exit /b 1
)

rem 同樣不用 dotnet run（Smart App Control 會擋剛寫入的檔案），理由見 啟動.cmd。
dotnet "tools\SongQuiz.BankBuilder\bin\Debug\net8.0\SongQuiz.BankBuilder.dll" %*

echo.
echo   題庫寫到 src\SongQuiz.Server\data\bank.json
echo   伺服器只在啟動時讀題庫，所以請重新執行「啟動.cmd」。
echo.
pause
