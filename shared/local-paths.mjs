import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const LOCAL_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'local-dev.json');

function defaultConfig() {
  return {
    rules: {
      host_protection: true,
      forbid_touching_host_files: true,
      forbid_touching_host_processes: true,
      forbid_touching_host_ports: true,
    },
    paths: {
      hermes_home: 'data/hermes-home',
      openclaw_home: 'data/openclaw-home',
      skills_dir: 'data/hermes-home/skills',
      memories_dir: 'data/hermes-home/memories',
      openclaw_review: 'reused/openclaw-review',
    },
    ports: {
      fusion_panel: 24318,
    },
  };
}

export function loadLocalConfig() {
  const config = fs.existsSync(LOCAL_CONFIG_PATH)
    ? JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf-8'))
    : defaultConfig();
  return {
    ...config,
    paths: Object.fromEntries(
      Object.entries(config.paths || {}).map(([key, value]) => [key, resolveProjectPath(value)]),
    ),
  };
}

export function resolveProjectPath(inputPath) {
  if (!inputPath) return inputPath;
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(PROJECT_ROOT, inputPath);
}
