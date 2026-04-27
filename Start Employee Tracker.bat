@echo off
title Employee Tracker Server
color 0A

echo ========================================================
echo             Employee Tracker Database Server
echo ========================================================
echo.
echo Please DO NOT CLOSE this window while using the application.
echo You can safely minimize it.
echo.
echo Starting server...
echo.

:: Launch the browser after a 2-second delay to let the server boot up
timeout /t 2 /nobreak > NUL
start http://localhost:3001

:: Start the Node.js server
npm start
