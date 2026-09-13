@echo off
chcp 65001 >nul
title 流行音樂猜歌王
cd /d "%~dp0"

if not exist "web\data\bank.js" (
    echo.
    echo   還沒有題庫。請先執行「重建題庫.cmd」。
    echo.
    pause
    exit /b 1
)

rem 這是純靜態站，沒有伺服器要啟動——直接把網頁交給瀏覽器就好。
rem 題庫刻意做成 web\data\bank.js（而不是 .json），因為 file:// 下
rem fetch 一個 .json 會被 CORS 擋，而 <script src> 不會。
start "" "%~dp0web\index.html"
exit /b 0
