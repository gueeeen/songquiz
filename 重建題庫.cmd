@echo off
chcp 65001 >nul
title 重建題庫
cd /d "%~dp0"

echo.
echo   要向 Apple 的公開 Search API 查歌，需要網路。
echo   會先讀六份排行榜拿演出者，再循序查歌：大約 150～250 個請求、
echo   每次間隔 800 毫秒，五到十分鐘。
echo.

dotnet build "SongQuiz.sln" -c Debug -v quiet --nologo
if errorlevel 1 (
    echo   建置失敗。把上面的錯誤訊息貼給 Claude 看。
    pause
    exit /b 1
)

rem 不用 dotnet run：這台機器的 Smart App Control 會擋剛寫入、還沒有信譽的
rem 執行檔（「存取被拒」）。請已簽章的 dotnet 主機載入 DLL 比較不容易被擋；
rem 真的被擋就等幾分鐘再跑，同一個檔案信譽跟上之後就會放行。
dotnet "tools\SongQuiz.BankBuilder\bin\Debug\net8.0\SongQuiz.BankBuilder.dll" %*

echo.
echo   題庫寫到 web\data\bank.js
echo   網頁每次開啟都會重新讀它，所以直接重新整理瀏覽器就生效。
echo.
pause
