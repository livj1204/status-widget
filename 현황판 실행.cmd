@echo off
chcp 65001 >nul
if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo 아직 설치가 안 됐어요. 이 폴더에서 먼저 npm install 을 실행해 주세요.
  pause
  exit /b 1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
