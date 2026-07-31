@echo off
cd /d "%~dp0"
echo Starting GarageOS at http://localhost:3000
call npm run dev
pause
