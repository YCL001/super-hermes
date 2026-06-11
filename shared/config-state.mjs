import fs from 'node:fs';
import path from 'node:path';
import { loadLocalConfig } from './local-paths.mjs';

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function safeJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function normalizeYaml(text) {
  return String(text || '').replace(/\r\n?/g, '\n');
}

export function getProjectConfigPaths() {
  const config = loadLocalConfig();
  const hermesHome = config.paths.hermes_home;
  const openclawHome = config.paths.openclaw_home;
  return {
    hermesHome,
    openclawHome,
    hermesConfigPath: path.join(hermesHome, 'config.yaml'),
    hermesEnvPath: path.join(hermesHome, '.env'),
    openclawConfigPath: path.join(openclawHome, 'openclaw.json'),
  };
}

export function readHermesConfigState() {
  const paths = getProjectConfigPaths();
  const raw = normalizeYaml(safeRead(paths.hermesConfigPath));
  const modelDefault = raw.match(/^model:\n(?:[ \t].*\n)*?[ \t]+default:\s*(.+)$/m)?.[1]?.trim() || '';
  const modelProvider = raw.match(/^model:\n(?:[ \t].*\n)*?[ \t]+provider:\s*(.+)$/m)?.[1]?.trim() || '';
  const terminalBackend = raw.match(/^terminal:\n(?:[ \t].*\n)*?[ \t]+backend:\s*(.+)$/m)?.[1]?.trim() || '';
  const reasoning = raw.match(/^agent:\n(?:[ \t].*\n)*?[ \t]+reasoning_effort:\s*(.+)$/m)?.[1]?.trim() || '';
  return {
    ...paths,
    modelDefault,
    modelProvider,
    terminalBackend,
    reasoning,
  };
}

export function readExecConfigState() {
  const paths = getProjectConfigPaths();
  const cfg = safeJson(paths.openclawConfigPath) || {};
  const fullModel = cfg?.agents?.defaults?.model?.primary || cfg?.agents?.defaults?.model || '';
  const [providerName = '', modelId = ''] = String(fullModel).split('/');
  const providers = cfg?.models?.providers || {};
  const provider = providers[providerName] || null;
  return {
    ...paths,
    raw: cfg,
    fullModel,
    providerName,
    modelId,
    provider,
    providerCount: Object.keys(providers).length,
  };
}

export function buildConfigSyncPayload(reason = 'unknown') {
  const hermes = readHermesConfigState();
  const exec = readExecConfigState();
  return {
    reason,
    at: new Date().toISOString(),
    hermes: {
      configPath: hermes.hermesConfigPath,
      modelDefault: hermes.modelDefault,
      modelProvider: hermes.modelProvider,
    },
    exec: {
      configPath: exec.openclawConfigPath,
      fullModel: exec.fullModel,
      providerName: exec.providerName,
      modelId: exec.modelId,
    },
  };
}
