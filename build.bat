@echo off
echo Installing dependencies (needs Node.js from nodejs.org)...
call npm install
echo Building Windows installer...
call npm run build
echo.
echo Done. Your installer is in the "dist" folder.
pause
