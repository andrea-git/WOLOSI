@echo off
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js/npm non trovato.
  pause
  exit /b 1
)

if not exist node_modules (
  call npm install
)

start "" "http://localhost:9000"
npx vercel dev --listen 9000
pause
