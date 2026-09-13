@echo off
chcp 65001 >nul
title 流行音樂猜歌王
cd /d "%~dp0"

echo.
echo   正在建置（第一次會久一點）...
echo.

dotnet build "SongQuiz.sln" -c Debug -v quiet --nologo
if errorlevel 1 (
    echo.
    echo   建置失敗。把上面的錯誤訊息貼給 Claude 看。
    echo.
    pause
    exit /b 1
)

if not exist "src\SongQuiz.Server\data\bank.json" (
    echo.
    echo   還沒有題庫。先執行「重建題庫.cmd」，抓完再來。
    echo.
    pause
    exit /b 1
)

rem 為什麼不是 dotnet run：
rem 這台機器的 Smart App Control 開在強制執行模式，會封鎖「剛寫入、還沒有信譽」
rem 的執行檔與 DLL——dotnet run 要啟動剛編出來的 SongQuiz.Server.exe，容易拿到
rem 「存取被拒」。改成請已簽章的 dotnet 主機載入 DLL 比較不容易被擋，但不是免疫：
rem 被擋的話等幾分鐘再跑，同一個檔案信譽查詢跟上之後就會放行。
rem
rem 要 cd 進專案目錄：ASP.NET Core 的 ContentRoot 取的是工作目錄，
rem 而 wwwroot 與 data\bank.json 都掛在那底下。
cd "src\SongQuiz.Server"

echo   開啟中：http://localhost:5000
echo   （手機想玩：把下面那行的 localhost 換成這台電腦的區域網路 IP，
echo     並改用「擺攤.cmd」開放對外連線）
echo.
echo   要結束就按 Ctrl+C。
echo.

start "" "http://localhost:5000"
dotnet "bin\Debug\net8.0\SongQuiz.Server.dll" --urls "http://localhost:5000"
