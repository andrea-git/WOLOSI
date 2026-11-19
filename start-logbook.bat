@echo off
cd /d "%~dp0"
start "" "http://localhost:9000"
where py >nul 2>nul
if %errorlevel%==0 (
    py -m http.server 9000
) else (
    python -m http.server 9000
)
pause
