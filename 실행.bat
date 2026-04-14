@echo off
chcp 65001 >nul 2>&1
title 디벨로켓 교안 도우미

echo.
echo  ============================================
echo   디벨로켓 교안 도우미
echo  ============================================
echo.

:: 스크립트 위치로 작업 디렉토리 이동
pushd "%~dp0"

:: Node.js 설치 확인
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [오류] Node.js가 설치되어 있지 않습니다.
    echo.
    echo  Node.js를 먼저 설치해주세요:
    echo  https://nodejs.org
    echo.
    echo  설치 후 이 파일을 다시 실행하세요.
    echo.
    pause
    exit /b 1
)

:: 포트 3000 사용 여부 확인 (netstat 대신 PowerShell로 안정적 체크)
powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue){exit 1}else{exit 0}" >nul 2>&1
if %errorlevel% equ 1 (
    echo  [알림] 포트 3000이 이미 사용 중입니다.
    echo  기존 서버가 실행 중일 수 있습니다.
    echo.
    echo  브라우저에서 http://127.0.0.1:3000 을 열어보세요.
    echo.
    start "" "http://127.0.0.1:3000"
    timeout /t 3 >nul
    exit /b 0
)

echo  서버를 시작합니다...
echo  [경로] %~dp0
echo.
node "%~dp0server.js"
if %errorlevel% neq 0 (
    echo.
    echo  [오류] 서버 실행에 실패했습니다.
    echo.
    echo  [진단 정보]
    node -v 2>nul && echo  Node.js 확인됨 || echo  Node.js 응답 없음
    echo  작업 경로: %CD%
    echo  스크립트 경로: %~dp0
    echo.
)
pause
