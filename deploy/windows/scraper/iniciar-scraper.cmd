@echo off
rem Sobe o scraper (FastAPI + uvicorn) na porta 8000. A tarefa do Windows roda este arquivo.
rem Tudo relativo a esta pasta (%~dp0 termina com "\").
set "RAIZ=%~dp0"
set "PLAYWRIGHT_BROWSERS_PATH=%RAIZ%browsers"
set "FB_COOKIES_FILE=%RAIZ%fb_cookies.json"
cd /d "%RAIZ%"
if not exist "%RAIZ%logs" mkdir "%RAIZ%logs"
"%RAIZ%python\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8000 >> "%RAIZ%logs\scraper.log" 2>&1
