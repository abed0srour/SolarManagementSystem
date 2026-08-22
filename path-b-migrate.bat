@echo off
REM Double-click this, or from cmd.exe type: path-b-migrate.bat
REM Just runs path-b-migrate.ps1 with the execution-policy restriction bypassed
REM for this one run (doesn't change your system's PowerShell settings).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0path-b-migrate.ps1" %*
pause
