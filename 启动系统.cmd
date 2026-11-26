@echo off
setlocal
cd /d "%~dp0"

set "APP_URL=http://localhost:4173/"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20.19 or newer is required. Install Node.js and try again.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js and enable adding it to PATH.
  pause
  exit /b 1
)
where curl.exe >nul 2>nul
if errorlevel 1 (
  echo curl.exe was not found. Update Windows and try again.
  pause
  exit /b 1
)

curl.exe -fsS --max-time 2 "%APP_URL%" -o nul 2>nul
if not errorlevel 1 (
  start "" "%APP_URL%"
  exit /b 0
)

if not exist "node_modules\" (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 goto failed
)

if not exist "dist\index.html" (
  echo Building the application...
  call npm run build
  if errorlevel 1 goto failed
)

echo Starting ORBIT...
start "ORBIT ??????????" /D "%~dp0" cmd /k npm start

for /l %%i in (1,1,30) do (
  curl.exe -fsS --max-time 2 "%APP_URL%" -o nul 2>nul
  if not errorlevel 1 (
    start "" "%APP_URL%"
    exit /b 0
  )
  ping 127.0.0.1 -n 2 >nul
)

echo Timed out waiting for the server. Check the server window for errors.
pause
exit /b 1

:failed
echo Startup failed. Check the error above and confirm network access.
pause
exit /b 1
