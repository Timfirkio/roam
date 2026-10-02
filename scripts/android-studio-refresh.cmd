@echo off
setlocal
cd /d "%~dp0.." || exit /b 1
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
call "%APPDATA%\npm\corepack.cmd" pnpm cap:sync
exit /b %ERRORLEVEL%
