import { taskOrchestrator } from '../../control-core/task-orchestrator.mjs';
import { runtimeScheduler } from '../../runtime/scheduler/index.mjs';

export function submitNonBlockingGoal(sessionId, goal, constraints = []) {
  return taskOrchestrator.submitUserGoal({ sessionId, goal, constraints });
}

export function getRuntimeSnapshot() {
  return {
    tasks: taskOrchestrator.listTasks(),
    workers: taskOrchestrator.listWorkers(),
  };
}

export function getScheduler() {
  return runtimeScheduler;
}
