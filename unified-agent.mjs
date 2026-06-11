import { submitNonBlockingGoal } from './adapters/hermes/nonblocking-entry.mjs';
import { taskOrchestrator } from './control-core/task-orchestrator.mjs';
import { getUnifiedSystemOverview } from './adapters/unified/system-overview.mjs';
import { loadModelPools, loadRoutingConfig } from './control-core/model-pool-loader.mjs';
import { getHermesOverview } from './control-core/hermes-adapter.mjs';
import { getOpenclawExecOverview } from './exec-core/openclaw-exec-adapter.mjs';

export class HermesOpenclawFusion {
  constructor() {
    this.identity = {
      name: 'Hermes OpenClaw Fusion Layer',
      architecture: 'Hermes host + embedded OpenClaw exec',
    };
  }

  submitGoal(sessionId, goal, constraints = []) {
    return submitNonBlockingGoal(sessionId, goal, constraints);
  }

  async submitGoalAndWait(sessionId, goal, constraints = [], timeout = 180000) {
    return taskOrchestrator.submitUserGoalAndWait({
      sessionId,
      goal,
      constraints,
      timeout,
    });
  }

  getOverview() {
    return getUnifiedSystemOverview();
  }

  getHermesCore() {
    return getHermesOverview();
  }

  getOpenclawExec() {
    return getOpenclawExecOverview();
  }

  getModelRouting() {
    return {
      pools: loadModelPools(),
      routing: loadRoutingConfig(),
    };
  }
}

export const hermesOpenclawFusion = new HermesOpenclawFusion();
