@echo off
setlocal
cd /d "%~dp0"
title ProjectAnvil - Local workspace
set "PROJECTANVIL_NODE=C:\Program Files\nodejs\node.exe"
if not exist "%PROJECTANVIL_NODE%" (
  echo Node.js was not found at C:\Program Files\nodejs\node.exe.
  echo ProjectAnvil requires Node.js 22.13 or newer. See README.md.
  pause
  exit /b 1
)
if not exist "node_modules\vinext\dist\cli.js" (
  echo ProjectAnvil dependencies are missing. See README.md, Developer setup.
  pause
  exit /b 1
)
echo Starting ProjectAnvil on this PC...
echo Address: http://127.0.0.1:5173
echo Keep this window open while using the app. Press Ctrl+C here to stop it.
echo.
"%PROJECTANVIL_NODE%" scripts\start-local.mjs
if errorlevel 1 (
  echo.
  echo ProjectAnvil could not start. Read the message above or see README.md.
  pause
)
endlocal
