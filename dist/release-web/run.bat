@echo off
setlocal
cd /d %~dp0
set HOST=127.0.0.1
if "%PORT%"=="" set PORT=8787
set DATA_DIR=%~dp0data\admin
set WEB_DIST_DIR=%~dp0apps\admin-web\dist
if not exist node_modules (
  npm install --omit=dev --no-audit --no-fund
)
node apps\admin-server\dist\index.js
