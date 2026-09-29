@echo off
rem Installs or updates Elise. Double-click this file from Windows Explorer.
rem (Run it yourself, not from Claude: apps started from inside Claude get
rem  sandboxed, so Windows would hide the install from your real Start menu.)
setlocal
cd /d "%~dp0"
title Elise setup

echo.
echo   Installing Elise...
echo.
taskkill /IM elise.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

rem Bring back calendar, settings and voice models (merges, never deletes events).
if exist "transfer\com.enigma.elise" (
  echo   Restoring your calendar, settings and voice models - this can take a minute...
  set "PY=voice\.venv\Scripts\python.exe"
  if not exist "voice\.venv\Scripts\python.exe" set "PY=python"
  call "%%PY%%" "scripts\restore_data.py"
  if errorlevel 1 (
    echo.
    echo   Something went wrong while restoring. Your data is still in the "transfer" folder.
    pause
    exit /b 1
  )
  rd /s /q "transfer" 2>nul
)

for %%F in ("installer\Elise_*_x64-setup.exe") do set "SETUP=%%F"
if not defined SETUP (
  echo   Could not find the installer in the "installer" folder.
  pause
  exit /b 1
)
start /wait "" "%SETUP%" /S

start "" "%LOCALAPPDATA%\Elise\elise.exe"
echo.
echo   Done! Elise is running in the tray and will start with Windows.
echo.
timeout /t 8
