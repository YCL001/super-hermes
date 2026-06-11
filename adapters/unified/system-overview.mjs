import { getHermesOverview } from '../../control-core/hermes-adapter.mjs';
import { getOpenclawExecOverview } from '../../exec-core/openclaw-exec-adapter.mjs';
import { taskOrchestrator } from '../../control-core/task-orchestrator.mjs';

export function getUnifiedSystemOverview() {
  return {
    system: 'Hermes',
    mode: 'host-hermes-embedded-openclaw-exec',
    hermesHost: getHermesOverview(),
    embeddedOpenclawExec: getOpenclawExecOverview(),
    runtime: {
      tasks: taskOrchestrator.listTasks(),
      workers: taskOrchestrator.listWorkers(),
    },
  };
}
