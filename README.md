# Super Hermes

Hermes + OpenClaw 融合面板。  
Hermes 主脑只派单，执行手干活，面板只看。

## 一条命令安装

```bash
# Linux / macOS
curl -fsSL https://github.com/YCL001/super-hermes/raw/main/install.sh | bash

# Windows
curl -fsSL https://github.com/YCL001/super-hermes/raw/main/install.bat | cmd
```

安装过程：
1. 检查 Node.js / Hermes（缺的自动装）
2. `git clone` 到 `~/super-hermes`
3. `npm install`
4. 终端交互输入 API 服务商信息（名称 / 接口地址 / 密钥 / 模型 / API 类型）
5. 自动生成配置文件
6. 完毕

## 启动

```bash
cd ~/super-hermes
npm run cockpit
```

打开浏览器访问 `http://127.0.0.1:24318/`

不开面板也能用——执行手是 Hermes 的一部分，不依赖面板。

## 架构

```
用户 ──→ Hermes CLI（主脑）
              │ 只派单，不干活
              ▼
        shared/executor.mjs（执行手）
              │ 直接跑 shell / spawn Hermes 子进程
              ▼
           结果返回用户

        ui-cockpit/（面板，纯展示）
              可选监控，不开不影响
```

## 项目结构

```
super-hermes/
├── shared/                      # 核心模块
│   ├── executor.mjs             # 执行手（唯一干活的地方）
│   ├── memory-manager.mjs       # 短指针记忆管理
│   └── local-paths.mjs          # 本地路径
├── runtime/
│   ├── scheduler/index.mjs      # 任务调度器
│   └── events/bus.mjs           # 事件总线
├── control-core/                # 控制层
├── exec-core/                   # 执行层接口
├── ui-cockpit/                  # Web 面板（纯展示）
├── install.sh                   # Linux/macOS 安装脚本
├── install.bat                  # Windows 安装脚本
└── package.json
```

## 配置

安装时交互式配置，每个服务商需要：

| 信息 | 示例 |
|------|------|
| 名称 | `deepseek` / `gs88` |
| 接口地址 | `https://api.deepseek.com` |
| 密钥 | `sk-xxx` |
| API 类型 | `openai-completions` / `openai-responses` |
| 模型 | `deepseek-v4-flash,gpt-5.5` |

配置文件存放在 `data/` 下，不写系统盘。

## 记忆系统

短指针 + 索引方案：

- `data/hermes-home/memories/INDEX.md` — 目录，每条只有一句话指针
- `data/hermes-home/memories/RULES.md` — 核心行为规则
- 详情文件单独存放，不堆在一个文件里

## 依赖

| 软件 | 说明 |
|------|------|
| Node.js 18+ | 运行面板（安装脚本会自动检查） |
| Hermes | AI Agent 框架（安装脚本会自动装） |
| npm 依赖 | `ws`（安装时 `npm install`） |
