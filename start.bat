@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
title ClipToManual - Auto-Environment & Portable Launcher

echo ======================================================================
echo   📖 ClipToManual - Auto-Environment & Portable Launcher
echo ======================================================================

:: 1. Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Node.js not found!
    echo Please install Node.js from https://nodejs.org before running.
    echo.
    pause
    exit /b 1
)

:: 2. Check and Install NPM Dependencies
if not exist "node_modules\" (
    echo.
    echo [1/4] First time setup: Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed. Please check your internet connection.
        pause
        exit /b 1
    )
) else (
    echo [1/4] Dependencies verified: OK
)

:: 3. Check yt-dlp
where yt-dlp >nul 2>nul
if %errorlevel% neq 0 (
    if not exist "yt-dlp.exe" (
        echo [2/4] Downloading yt-dlp.exe...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', 'yt-dlp.exe')"
        if exist "yt-dlp.exe" (
            echo [2/4] yt-dlp.exe downloaded successfully.
        ) else (
            echo [WARNING] Could not download yt-dlp.exe. Using native extractor.
        )
    ) else (
        echo [2/4] yt-dlp executable: Found local yt-dlp.exe
    )
) else (
    echo [2/4] yt-dlp executable: Found in system PATH
)

:: 4. Check .env configuration file
if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env > nul
        echo [3/4] Created default .env configuration.
    )
) else (
    echo [3/4] Configuration file (.env): OK
)

:: 5. Free stuck process on port 3100
echo [4/4] Checking and clearing port 3100...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3100') do (
    taskkill /f /pid %%a >nul 2>nul
)

:: 6. Launch Web Server & Open Browser after ready
echo.
echo ======================================================================
echo   🚀 Starting server at http://localhost:3100 ...
echo ======================================================================
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3100"
call npm run dev
