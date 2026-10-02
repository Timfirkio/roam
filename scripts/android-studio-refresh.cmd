@echo off
setlocal
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
call "%APPDATA%\npm\corepack.cmd" pnpm cap:sync
exit /b %ERRORLEVEL%
