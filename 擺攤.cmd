@echo off
chcp 65001 >nul
title 流行音樂猜歌王（開放同網段連線）
cd /d "%~dp0"

echo.
echo   擺攤模式：同一個 Wi-Fi 的手機都連得進來。
echo.

dotnet build "SongQuiz.sln" -c Debug -v quiet --nologo
if errorlevel 1 (
    echo   建置失敗。把上面的錯誤訊息貼給 Claude 看。
    pause
    exit /b 1
)

if not exist "src\SongQuiz.Server\data\bank.json" (
    echo   還沒有題庫。先執行「重建題庫.cmd」。
    pause
    exit /b 1
)

echo   這台電腦的區域網路位址：
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo     http://%%a:5000
echo.
echo   把上面任一行念給大家，讓他們用手機瀏覽器打開。
echo   第一次可能要在防火牆提示上按「允許」。
echo   要結束就按 Ctrl+C。
echo.

cd "src\SongQuiz.Server"
dotnet "bin\Debug\net8.0\SongQuiz.Server.dll" --urls "http://0.0.0.0:5000"
