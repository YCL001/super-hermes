import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const LOCAL_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'local-dev.json');

export function loadLocalConfig() {
  const raw = fs.readFileSync(LOCAL_CONFIG_PATH, 'utf-8');
  const config = JSON.parse(raw);
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
