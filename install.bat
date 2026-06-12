@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

echo.
echo ============================================================
echo   Super Hermes - Windows Install
echo ============================================================
echo.

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "HERMES_HOME=%PROJECT_DIR%\data\hermes-home"
set "OPENCLAW_HOME=%PROJECT_DIR%\data\openclaw-home"
set "CONFIG_DIR=%PROJECT_DIR%\config"

echo [1/5] Check Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js not found. Install Node.js 18+ first:
  echo   https://nodejs.org/
  pause
  exit /b 1
)
for /f %%i in ('node -v') do echo   OK %%i
echo.

echo [2/5] Check Git
where git >nul 2>nul
if errorlevel 1 (
  echo   Git not found. Install Git for Windows first:
  echo   https://git-scm.com/download/win
  pause
  exit /b 1
)
for /f "tokens=*" %%i in ('git --version') do echo   OK %%i
echo.

echo [3/5] Check Hermes CLI
where hermes >nul 2>nul
if errorlevel 1 (
  echo   Hermes CLI not found.
  echo   Install it first, then rerun this script.
  echo   Recommended:
  echo   https://hermes-agent.nousresearch.com/
  pause
  exit /b 1
)
for /f "tokens=*" %%i in ('hermes --version 2^>nul') do echo   OK %%i
echo.

echo [4/5] Install npm dependencies
cd /d "%PROJECT_DIR%"
call npm install --silent
if errorlevel 1 (
  echo   npm install failed.
  pause
  exit /b 1
)
echo   OK dependencies installed
echo.

echo [5/5] Prepare local data
if not exist "%HERMES_HOME%" mkdir "%HERMES_HOME%"
if not exist "%HERMES_HOME%\logs" mkdir "%HERMES_HOME%\logs"
if not exist "%HERMES_HOME%\memories" mkdir "%HERMES_HOME%\memories"
if not exist "%HERMES_HOME%\skills" mkdir "%HERMES_HOME%\skills"
if not exist "%OPENCLAW_HOME%" mkdir "%OPENCLAW_HOME%"
if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"
if not exist "%PROJECT_DIR%\logs" mkdir "%PROJECT_DIR%\logs"

if not exist "%HERMES_HOME%\.env" (
  > "%HERMES_HOME%\.env" (
    echo # Fill in your provider API keys, for example:
    echo # DEEPSEEK_API_KEY=sk-xxxx
  )
  echo   Created data\hermes-home\.env
) else (
  echo   Keep existing data\hermes-home\.env
)

if not exist "%HERMES_HOME%\config.yaml" (
  > "%HERMES_HOME%\config.yaml" (
    echo model:
    echo   default: your-model-id
    echo   provider: custom:your-provider
    echo   base_url: https://your-api-base-url
    echo providers:
    echo   your-provider:
    echo     name: your-provider
    echo     api: https://your-api-base-url/v1
    echo     key_env: YOUR_PROVIDER_API_KEY
    echo     default_model: your-model-id
    echo     models:
    echo       your-model-id: {{}}
    echo     discover_models: false
    echo agent:
    echo   max_turns: 60
    echo terminal:
    echo   backend: local
    echo   timeout: 180
  )
  echo   Created data\hermes-home\config.yaml
) else (
  echo   Keep existing data\hermes-home\config.yaml
)

if not exist "%OPENCLAW_HOME%\openclaw.json" (
  > "%OPENCLAW_HOME%\openclaw.json" (
    echo {{
    echo   "gateway": {{ "mode": "internal-exec-only", "auth": {{ "mode": "disabled" }} }},
    echo   "agents": {{ "defaults": {{ "models": {{}}, "model": {{ "primary": "your-provider/your-model-id" }} }} }},
    echo   "models": {{ "mode": "merge", "providers": {{}} }},
    echo   "auth": {{ "profiles": {{}} }},
    echo   "plugins": {{ "entries": {{}}, "allow": [] }}
    echo }}
  )
  echo   Created data\openclaw-home\openclaw.json
) else (
  echo   Keep existing data\openclaw-home\openclaw.json
)

if not exist "%CONFIG_DIR%\local-dev.json" (
  > "%CONFIG_DIR%\local-dev.json" (
    echo {{
    echo   "rules": {{ "host_protection": true }},
    echo   "paths": {{
    echo     "hermes_home": "data/hermes-home",
    echo     "openclaw_home": "data/openclaw-home",
    echo     "memories_dir": "data/hermes-home/memories",
    echo     "skills_dir": "data/hermes-home/skills"
    echo   }},
    echo   "ports": {{ "fusion_panel": 24318 }}
    echo }}
  )
  echo   Created config\local-dev.json
) else (
  echo   Keep existing config\local-dev.json
)

if not exist "%HERMES_HOME%\memories\INDEX.md" (
  > "%HERMES_HOME%\memories\INDEX.md" (
    echo # Memory Index
    echo.
    echo Store short pointers here. Put details into separate markdown files.
  )
)

if not exist "%HERMES_HOME%\memories\RULES.md" (
  > "%HERMES_HOME%\memories\RULES.md" (
    echo # Rules
    echo.
    echo - Hermes receives and decomposes tasks.
    echo - Executors perform shell and model actions.
    echo - The cockpit is optional and does not own execution.
  )
)

echo.
echo Install complete.
echo.
echo Next steps:
echo   1. Edit data\hermes-home\.env
echo   2. Edit data\hermes-home\config.yaml
echo   3. Start the cockpit with: npm run cockpit
echo   4. Or run the one-click start script
echo.
pause
