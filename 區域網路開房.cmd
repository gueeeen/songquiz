@echo off
chcp 65001 >nul
title 猜歌王 · 區域網路開房
cd /d "%~dp0"

echo.
echo   這會把這台電腦變成「同一個 Wi-Fi 底下的猜歌王伺服器」。
echo   不需要帳號、不需要金鑰、不需要網路（連得上同一個分享器就夠了）。
echo.

if not exist "web\data\bank.js" (
    echo   還沒有題庫。請先執行「重建題庫.cmd」。
    echo.
    pause
    exit /b 1
)

dotnet build "SongQuiz.sln" -c Debug -v quiet --nologo
if errorlevel 1 (
    echo   建置失敗。把上面的錯誤訊息貼給 Claude 看。
    pause
    exit /b 1
)

rem 不用 dotnet run：這台機器的 Smart App Control 會擋剛寫入、還沒有信譽的
rem 執行檔（「存取被拒」）。請已簽章的 dotnet 主機載入 DLL 比較不容易被擋；
rem 真的被擋就等幾分鐘再跑，同一個檔案信譽跟上之後就會放行。
rem 不要為了繞過它改程式。
echo.
echo   ════════════════════════════════════════════════════════
echo     伺服器啟動後，下面會印出這台電腦的區域網路網址。
echo     叫朋友用手機瀏覽器打開那個網址，就能加入房間。
echo.
echo     第一次跑的話，Windows 防火牆會跳出提示——要按「允許存取」，
echo     而且「私人網路」那個勾要打勾，不然朋友連不進來。
echo   ════════════════════════════════════════════════════════
echo.

dotnet "tools\SongQuiz.LanServer\bin\Debug\net8.0\SongQuiz.LanServer.dll" %*

echo.
echo   伺服器已經停了。朋友那邊的房間也跟著散了。
echo.
pause
