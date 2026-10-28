@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo start: dsh web --patch "%~dp0cordis.dev.patch.yml"
dsh web --patch "%~dp0cordis.dev.patch.yml"
echo.
echo dsh exited with code %errorlevel%
pause
