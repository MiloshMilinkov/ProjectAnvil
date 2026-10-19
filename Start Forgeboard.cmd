@echo off
setlocal
cd /d "%~dp0"
set "FORGEBOARD_NODE=C:\Program Files\nodejs\node.exe"
if not exist "%FORGEBOARD_NODE%" (
  echo Node.js was not found at C:\Program Files\nodejs\node.exe.
  echo Install Node.js 22.13 or newer, then update this launcher if needed.
  pause
  exit /b 1
)
if not exist "node_modules\vinext\dist\cli.js" (
  echo Forgeboard needs its dependencies first. See README.md, Local setup.
  pause
  exit /b 1
)
echo Starting your local Forgeboard workspace...
echo Open the localhost address printed below, usually http://localhost:5173.
echo Keep this window open. Press Ctrl+C here to stop the app.
echo The online team workspace uses its published website address instead.
"%FORGEBOARD_NODE%" scripts\run-framework.mjs dev
if errorlevel 1 (
  echo Forgeboard could not start. See the message above and README.md.
  pause
)
endlocal
