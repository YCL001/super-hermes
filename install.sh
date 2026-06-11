#!/usr/bin/env bash
set -euo pipefail

echo ''
echo '╔══════════════════════════════════════════════╗'
echo '║      Super Hermes — 一键安装                ║'
echo '╚══════════════════════════════════════════════╝'
echo ''

# 1. Node.js
echo '[1/5] 检查 Node.js'
if ! command -v node &>/dev/null; then
  echo '  未安装 Node.js，请先安装: https://nodejs.org'
  exit 1
fi
echo "  OK $(node -v)"

# 2. Hermes
echo '[2/5] 检查 Hermes'
if ! command -v hermes &>/dev/null; then
  echo '  未安装 Hermes，正在安装...'
  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
  echo '  Hermes 安装完成，请重新打开终端后再次运行本命令'
  exit 0
fi
echo "  OK $(hermes --version 2>/dev/null || echo 'installed')"

# 3. 下载 / 更新
echo '[3/5] 下载 / 更新项目'
TARGET_DIR="$HOME/super-hermes"
if [ -d "$TARGET_DIR" ]; then
  echo "  目录已存在，正在更新..."
  cd "$TARGET_DIR"
  git pull || echo '  ⚠ git pull 失败，继续使用当前版本'
else
  cd "$HOME"
  git clone https://github.com/YCL001/super-hermes.git
  echo "  已下载到 $TARGET_DIR"
fi
cd "$TARGET_DIR"

# 4. npm（更新模式永远重装）
echo '[4/5] 安装 npm 依赖'
npm install --silent
echo '  OK 依赖安装完成'

mkdir -p data/hermes-home/logs data/hermes-home/memories data/hermes-home/skills data/openclaw-home config logs

need_provider_input=false
if [ ! -f data/hermes-home/.env ] || [ ! -f data/hermes-home/config.yaml ] || [ ! -f data/openclaw-home/openclaw.json ]; then
  need_provider_input=true
fi

if [ "$need_provider_input" = true ]; then
  # 5. 配置 API Provider（交互式）
  echo '[5/5] 配置 API 服务商'
  echo ''
  echo '  需要你提供 API 信息，至少配一个服务商。'
  echo '  每个服务商需要：名称、接口地址、密钥、可用模型。'
  echo ''

  PROVIDERS=()
  INDEX=1
  while true; do
    echo "  ── 服务商 $INDEX ──"
    echo ''
    read -rp "  名称 (如 deepseek/gs88/openai): " P_NAME
    [ -z "$P_NAME" ] && { echo '  名称不能为空'; continue; }
    read -rp "  接口地址 (如 https://api.deepseek.com): " P_URL
    [ -z "$P_URL" ] && { echo '  接口地址不能为空'; continue; }
    read -rp "  密钥: " P_KEY
    [ -z "$P_KEY" ] && { echo '  密钥不能为空'; continue; }
    echo '  API 类型:'
    echo '    1) openai-completions  — 标准 Chat Completions (DeepSeek 等)'
    echo '    2) openai-responses    — Responses API (GS88 中转等)'
    read -rp "  选一个 (默认 1): " P_API_TYPE
    [ -z "$P_API_TYPE" ] && P_API_TYPE=1
    [ "$P_API_TYPE" = "2" ] && P_API="openai-responses" || P_API="openai-completions"
    read -rp "  模型列表 (逗号分隔, 如 deepseek-v4-flash,gpt-5.5): " P_MODELS
    [ -z "$P_MODELS" ] && { echo '  模型不能为空'; continue; }

    PROVIDERS+=("$P_NAME|$P_URL|$P_KEY|$P_API|$P_MODELS")

    if [ $INDEX -ge 2 ]; then
      read -rp "  还要配下一个吗? (y/n): " MORE
      [ "$MORE" != "y" ] && break
    else
      read -rp "  还要配第 2 个吗? (y/n): " MORE
      [ "$MORE" != "y" ] && break
    fi
    INDEX=$((INDEX + 1))
  done

  echo ''
  echo '  正在生成配置文件...'

  # ── 写 .env（存在则不覆盖） ──
  ENV_FILE="data/hermes-home/.env"
  if [ ! -f "$ENV_FILE" ]; then
    : > "$ENV_FILE"
    for entry in "${PROVIDERS[@]}"; do
      IFS='|' read -r name url key api models <<< "$entry"
      upper_name=$(echo "$name" | tr '[:lower:]' '[:upper:]')
      echo "${upper_name}_API_KEY=$key" >> "$ENV_FILE"
    done
    echo "  ✓ $ENV_FILE"
  else
    echo "  保留已有 $ENV_FILE"
  fi

  # ── 写 Hermes config.yaml（存在则不覆盖） ──
  YAML_FILE="data/hermes-home/config.yaml"
  if [ ! -f "$YAML_FILE" ]; then
    FIRST_PROVIDER="${PROVIDERS[0]}"
    IFS='|' read -r firstName firstUrl firstKey firstApi firstModels <<< "$FIRST_PROVIDER"
    firstModel=$(echo "$firstModels" | cut -d',' -f1 | xargs)

    hermesProvider="$firstName"
    if [ "$firstName" != "deepseek" ]; then
      hermesProvider="custom:$firstName"
    fi

    cat > "$YAML_FILE" <<YAML
model:
  default: $firstModel
  provider: $hermesProvider
  base_url: $firstUrl
providers:
YAML

    for entry in "${PROVIDERS[@]}"; do
      IFS='|' read -r name url key api models <<< "$entry"
      models_list=$(echo "$models" | tr ',' ' ')
      cat >> "$YAML_FILE" <<YAML
  $name:
    name: $name
    api: $url/v1
    key_env: $(echo "$name" | tr '[:lower:]' '[:upper:]')_API_KEY
    default_model: $(echo "$models_list" | awk '{print $1}')
    models:
YAML
      for m in $models_list; do
        echo "      $m: {}" >> "$YAML_FILE"
      done
      echo "    discover_models: false" >> "$YAML_FILE"
      if [ "$api" = "openai-responses" ]; then
        echo "    transport: codex_responses" >> "$YAML_FILE"
      fi
    done

    cat >> "$YAML_FILE" <<YAML
agent:
  max_turns: 60
terminal:
  backend: local
  timeout: 180
YAML
    echo "  ✓ $YAML_FILE"
  else
    echo "  保留已有 $YAML_FILE"
  fi

  # ── 写 OpenClaw openclaw.json（存在则不覆盖） ──
  OC_FILE="data/openclaw-home/openclaw.json"
  if [ ! -f "$OC_FILE" ]; then
    FIRST_PROVIDER="${PROVIDERS[0]}"
    IFS='|' read -r firstName firstUrl firstKey firstApi firstModels <<< "$FIRST_PROVIDER"
    firstModel=$(echo "$firstModels" | cut -d',' -f1 | xargs)
    firstFull="${firstName}/${firstModel}"

    {
      echo '{'
      echo '  "gateway": { "mode": "internal-exec-only", "auth": { "mode": "disabled" } },'
      echo '  "agents": { "defaults": { "models": {}, "model": { "primary": "'"$firstFull"'" } } },'
      echo '  "models": { "mode": "merge", "providers": {'
      FIRST=true
      for entry in "${PROVIDERS[@]}"; do
        IFS='|' read -r name url key api models <<< "$entry"
        $FIRST || echo ','
        FIRST=false
        echo -n "      \"$name\": { \"baseUrl\": \"$url\", \"api\": \"$api\", \"apiKey\": \"$key\", \"models\": ["
        IFS=',' read -ra model_arr <<< "$models"
        for i in "${!model_arr[@]}"; do
          [ $i -gt 0 ] && echo -n ','
          m=$(echo "${model_arr[$i]}" | xargs)
          echo -n "{\"id\":\"$m\",\"name\":\"$m\",\"contextWindow\":1000000}"
        done
        echo -n '] }'
      done
      echo ''
      echo '    } },'
      echo '  "auth": { "profiles": {} },'
      echo '  "plugins": { "entries": {}, "allow": [] }'
      echo '}'
    } > "$OC_FILE"
    echo "  ✓ $OC_FILE"
  else
    echo "  保留已有 $OC_FILE"
  fi

  # ── 写 config/local-dev.json（存在则不覆盖） ──
  if [ ! -f config/local-dev.json ]; then
    cat > config/local-dev.json <<'EOF'
{
  "rules": {
    "host_protection": true,
    "forbid_touching_host_files": true,
    "forbid_touching_host_processes": true,
    "forbid_touching_host_ports": true
  },
  "paths": {
    "hermes_home": "data/hermes-home",
    "openclaw_home": "data/openclaw-home",
    "memories_dir": "data/hermes-home/memories",
    "skills_dir": "data/hermes-home/skills"
  },
  "ports": { "fusion_panel": 24318 }
}
EOF
    echo "  ✓ config/local-dev.json"
  else
    echo "  保留已有 config/local-dev.json"
  fi
else
  echo '[5/5] 配置已存在，保留 .env / config.yaml / openclaw.json'
fi

# 初始化记忆索引（已存在则跳过，不覆盖）
MEM_DIR=data/hermes-home/memories
if [ ! -f "$MEM_DIR/INDEX.md" ]; then
cat > "$MEM_DIR/INDEX.md" <<'EOF'
# 记忆索引

> 短指针 + 详情文件。索引只留一句话指针，详情看对应文件。

## 📌 核心规则

| 文件 | 说明 |
|------|------|
| `RULES.md` | Hermes 行为规则 |

## 📓 笔记

| 文件 | 说明 |
|------|------|

EOF
echo "  + INDEX.md"
fi

if [ ! -f "$MEM_DIR/RULES.md" ]; then
cat > "$MEM_DIR/RULES.md" <<'EOF'
§
⚡ **核心规则: 主脑职责** > Hermes 只负责接收任务、拆解、派给执行手。
   禁止直接执行任何系统命令、文件操作或 LLM 调用。
§
⚡ **执行手职责** > 执行手（executor.mjs）是唯一有权限直接干活（shell / LLM）的模块。
§
⚡ **面板定位** > 面板 UI 仅为可视化监控，不开面板不影响执行手工作。
§
EOF
echo "  + RULES.md"
fi

echo "  ✓ 记忆索引初始化完成"

# ── 完成 ──
echo ''
echo '╔══════════════════════════════════════════════╗'
echo '║      安装完成！                              ║'
echo '╚══════════════════════════════════════════════╝'
echo ''
echo "  启动面板:  cd $TARGET_DIR && npm run cockpit"
echo "  访问面板:  http://127.0.0.1:24318/"
echo "  日志目录:  $TARGET_DIR/data/hermes-home/logs"
echo ''
