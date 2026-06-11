@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo ╔══════════════════════════════════════════════╗
echo ║      Super Hermes — 一键安装 (Windows)      ║
echo ╚══════════════════════════════════════════════╝
echo.

rem ── 1. Node.js ──
echo [1/5] 检查 Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
  echo   未安装 Node.js，请先安装: https://nodejs.org
  pause & exit /b 1
)
for /f %%i in ('node -v') do echo   OK %%i

rem ── 2. Hermes ──
echo [2/5] 检查 Hermes
hermes --version >nul 2>&1
if %errorlevel% neq 0 (
  echo   未安装 Hermes，正在安装...
  curl -fsSL https://hermes-agent.nousresearch.com/install.bat -o "%TEMP%\hermes_install.bat"
  if !errorlevel! neq 0 (echo   下载失败 & pause & exit /b 1)
  call "%TEMP%\hermes_install.bat"
  echo   Hermes 安装完成，请重启终端后再次运行
  pause & exit /b 0
)
for /f %%i in ('hermes --version 2^>nul') do echo   OK %%i

rem ── 3. 下载 / 更新 ──
echo [3/5] 下载 / 更新项目
set TARGET_DIR=%USERPROFILE%\super-hermes
if exist "%TARGET_DIR%" (
  echo   目录已存在，正在更新...
  cd /d "%TARGET_DIR%"
  git pull
  if !errorlevel! neq 0 (echo   ⚠ git pull 失败，继续使用当前版本)
) else (
  cd /d "%USERPROFILE%"
  git clone https://github.com/YCL001/super-hermes.git
  if !errorlevel! neq 0 (echo   克隆失败 & pause & exit /b 1)
  echo   已下载到 %TARGET_DIR%
)
cd /d "%TARGET_DIR%"

rem ── 4. npm（更新模式永远重装） ──
echo [4/5] 安装 npm 依赖
call npm install --silent
if !errorlevel! neq 0 (echo   npm install 失败 & pause & exit /b 1)
echo   OK 依赖安装完成

rem ── 5. 交互式配置 ──
echo [5/5] 配置 API 服务商
echo.
echo   需要你提供 API 信息，至少配一个服务商。
echo   每个服务商需要：名称、接口地址、密钥、可用模型。
echo.

mkdir data\hermes-home data\openclaw-home config 2>nul

rem 用 PowerShell 脚本处理交互 + 写配置（YAML/JSON 用 PS 写更稳）
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
$target = '%TARGET_DIR%'; ^
$providers = @(); ^
$index = 1; ^
do { ^
  Write-Host ('`n  --- 服务商 ' + $index + ' ---'); ^
  $name = Read-Host '   名称 (如 deepseek/gs88)'; ^
  $url = Read-Host '   接口地址 (如 https://api.deepseek.com)'; ^
  $key = Read-Host '   密钥'; ^
  Write-Host '   API 类型:'; ^
  Write-Host '     1) openai-completions  — 标准 Chat Completions (DeepSeek 等)'; ^
  Write-Host '     2) openai-responses    — Responses API (GS88 中转等)'; ^
  $apiType = Read-Host '   选一个 (默认 1)'; ^
  if (-not $apiType -or $apiType -eq '1') { $api='openai-completions' } else { $api='openai-responses' }; ^
  $models = Read-Host '   模型 (逗号分隔，如 deepseek-v4-flash,gpt-5.5)'; ^
  if (-not $name -or -not $url -or -not $key -or -not $models) { ^
    Write-Host '   所有字段必填'; continue ^
  }; ^
  $providers += @{name=$name; url=$url; key=$key; api=$api; models=($models -split ',')}; ^
  $index++; ^
  if ($index -ge 3) { $more = Read-Host '   还要配下一个吗? (y/n)' } else { $more = Read-Host '   还要配第 2 个吗? (y/n)' }; ^
} while ($more -eq 'y'); ^
Write-Host '`n   正在生成配置文件...'; ^
# ── 写 .env ── ^
$envLines = $providers | ForEach-Object { $_.name.ToUpper() + '_API_KEY=' + $_.key }; ^
[IO.File]::WriteAllLines([IO.Path]::Combine($target, 'data\hermes-home\.env'), $envLines); ^
Write-Host '   OK data/hermes-home/.env'; ^
# ── 写 Hermes config.yaml ── ^
$yamlLines = @(); ^
$first = $providers[0]; ^
$firstModel = $first.models[0]; ^
$yamlLines += 'model:'; ^
$yamlLines += ('  default: ' + $firstModel); ^
$yamlLines += ('  provider: ' + $first.name); ^
$yamlLines += ('  base_url: ' + $first.url); ^
$yamlLines += 'providers:'; ^
foreach ($p in $providers) { ^
  $upper = $p.name.ToUpper(); ^
  $yamlLines += ('  ' + $p.name + ':'); ^
  $yamlLines += ('    name: ' + $p.name); ^
  $yamlLines += ('    api: ' + $p.url + '/v1'); ^
  $yamlLines += ('    key_env: ' + $upper + '_API_KEY'); ^
  $yamlLines += ('    default_model: ' + $p.models[0]); ^
  $yamlLines += '    models:'; ^
  foreach ($m in $p.models) { $yamlLines += ('      ' + $m + ': {}') }; ^
  $yamlLines += '    discover_models: false'; ^
}; ^
$yamlLines += 'agent:'; ^
$yamlLines += '  max_turns: 60'; ^
$yamlLines += 'terminal:'; ^
$yamlLines += '  backend: local'; ^
$yamlLines += '  timeout: 180'; ^
[IO.File]::WriteAllLines([IO.Path]::Combine($target, 'data\hermes-home\config.yaml'), $yamlLines); ^
Write-Host '   OK data/hermes-home/config.yaml'; ^
# ── 写 openclaw.json ── ^
$ocModels = @{}; ^
foreach ($p in $providers) { ^
  $ocModels[$p.name] = @{baseUrl=$p.url; api=$p.api; apiKey=$p.key; models=($p.models | ForEach-Object { @{id=$_; name=$_; contextWindow=1000000} })}; ^
}; ^
$oc = @{ ^
  gateway=@{mode='internal-exec-only'; auth=@{mode='disabled'}}; ^
  agents=@{defaults=@{models=@{}; model=@{primary=($first.name + '/' + $firstModel)}}}; ^
  models=@{mode='merge'; providers=$ocModels}; ^
  auth=@{profiles=@{}}; ^
  plugins=@{entries=@{}; allow=@()}; ^
}; ^
$ocJson = ConvertTo-Json $oc -Depth 10; ^
[IO.File]::WriteAllText([IO.Path]::Combine($target, 'data\openclaw-home\openclaw.json'), $ocJson); ^
Write-Host '   OK data/openclaw-home/openclaw.json'; ^
# ── local-dev.json ── ^
$dev = @{rules=@{host_protection=$true};paths=@{hermes_home='data/hermes-home';openclaw_home='data/openclaw-home';memories_dir='data/hermes-home/memories';skills_dir='data/hermes-home/skills'};ports=@{fusion_panel=24318}}; ^
[IO.File]::WriteAllText([IO.Path]::Combine($target, 'config\local-dev.json'), (ConvertTo-Json $dev -Depth 5)); ^
Write-Host '   OK config/local-dev.json'; ^
Write-Host ''

if %errorlevel% neq 0 (echo   配置写入失败 & pause & exit /b 1)

mkdir data\hermes-home\memories data\hermes-home\skills logs 2>nul

rem 初始化记忆索引
powershell -NoProfile -Command ^
  $dir = '%TARGET_DIR%\data\hermes-home\memories'; ^
  $idx = [IO.Path]::Combine($dir, 'INDEX.md'); ^
  $rules = [IO.Path]::Combine($dir, 'RULES.md'); ^
  if (-not (Test-Path $idx)) { ^
    '# 记忆索引', '', '> 短指针 + 详情文件。索引只留一句话指针，详情看对应文件。', '', '## 📌 核心规则', '', '| 文件 | 说明 |', '|------|------|', '| `RULES.md` | Hermes 行为规则 |', '', '## 📓 笔记', '', '| 文件 | 说明 |', '|------|------|', '' -join [Environment]::NewLine ^
      | Out-File -FilePath $idx -Encoding utf8; ^
  }; ^
  if (-not (Test-Path $rules)) { ^
    ('§','⚡ **核心规则: 主脑职责** > Hermes 只负责接收任务、拆解、派给执行手。','   禁止直接执行任何系统命令、文件操作或 LLM 调用。','§','⚡ **执行手职责** > 执行手（executor.mjs）是唯一有权限直接干活（shell / LLM）的模块。','§','⚡ **面板定位** > 面板 UI 仅为可视化监控，不开面板不影响执行手工作。','§','') -join [Environment]::NewLine ^
      | Out-File -FilePath $rules -Encoding utf8; ^
  }; ^
  Write-Host '   OK 记忆索引初始化完成'

echo.
echo ╔══════════════════════════════════════════════╗
echo ║      安装完成！                              ║
echo ╚══════════════════════════════════════════════╝
echo.
echo   启动面板:   cd /d "%TARGET_DIR%" ^&^& npm run cockpit
echo   访问面板:   http://127.0.0.1:24318/
echo.
pause
