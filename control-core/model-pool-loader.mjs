import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '../runtime/model-pools.json');

function loadRawConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

export function loadModelPools() {
  return loadRawConfig().modelPools;
}

export function loadRoutingConfig() {
  return loadRawConfig().routing;
}

export function getPool(poolName) {
  const pools = loadModelPools();
  const pool = pools[poolName];
  if (!pool) {
    throw new Error(`Unknown model pool: ${poolName}`);
  }
  return pool;
}

export function choosePoolForStage(stage, attempt = 0) {
  const routing = loadRoutingConfig();

  if (stage === 'planning') return getPool(routing.plannerPool);
  if (stage === 'approval') return getPool(routing.approvalPool);
  if (stage === 'execution' && attempt >= routing.maxWorkerRetriesBeforeEscalation) {
    return getPool(routing.retryEscalationPool);
  }
  return getPool(routing.defaultTaskPool);
}
