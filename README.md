# Super Hermes

Super Hermes is a local fusion workspace for Hermes + OpenClaw. Hermes handles task decomposition, executors perform the actual work, and the cockpit provides a web view for status and operations.

## Install

### Linux / macOS

```bash
curl -fsSL https://github.com/YCL001/super-hermes/raw/main/install.sh | bash
```

### Windows

Do not use `curl ... | cmd`. On Windows, download first and then run:

```powershell
curl.exe -L "https://github.com/YCL001/super-hermes/raw/main/install.bat" -o install.bat
cmd /c install.bat
```

Or inside the cloned repository, just double-click `install.bat`.

## What The Installer Does

1. Checks `Node.js`
2. Checks `Git`
3. Checks `Hermes CLI`
4. Runs `npm install`
5. Creates local config and data directories if missing

The installer does not overwrite existing local config files.

## Start

### Start cockpit only

```bash
npm run cockpit
```

Then open `http://127.0.0.1:24318/`.

### Windows one-click start

Double-click:

- `一键启动.cmd`

It will:

1. Start the cockpit service
2. Open the cockpit page in the browser
3. Start the Hermes CLI

## Local Files

The project keeps local state under `data/`:

- `data/hermes-home/.env`
- `data/hermes-home/config.yaml`
- `data/openclaw-home/openclaw.json`
- `config/local-dev.json`

Fill in your own provider URLs, API keys, and model IDs there after installation.

## Requirements

- `Node.js` 18+
- `Git`
- `Hermes CLI`
- npm dependency: `ws`
