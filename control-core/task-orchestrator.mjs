import { choosePoolForStage } from './model-pool-loader.mjs';
import { runtimeScheduler } from '../runtime/scheduler/index.mjs';

export class TaskOrchestrator {
  submitUserGoal(input) {
    const plannerPool = choosePoolForStage('planning');

    const task = runtimeScheduler.createTask({
      sessionId: input.sessionId,
      goal: input.goal,
      constraints: input.constraints,
      plannerPool,
    });

    return {
      accepted: true,
      message: '任务已进入后台执行队列',
      taskId: task.id,
      status: task.status,
      plannerPool,
      workerSlot: task.workerSlot ?? null,
    };
  }

  async submitUserGoalAndWait(input) {
    const plannerPool = choosePoolForStage('planning');

    const task = runtimeScheduler.createTask({
      sessionId: input.sessionId,
      goal: input.goal,
      constraints: input.constraints,
      plannerPool,
    });

    // 等待任务执行完成
    const result = await runtimeScheduler.waitForTask(task.id, input.timeout || 180000);
    return {
      accepted: true,
      taskId: result.id,
      status: result.status,
      resultSummary: result.resultSummary || '',
      workerSlot: result.workerSlot ?? null,
    };
  }

  listTasks() {
    return runtimeScheduler.listTasks();
  }

  listWorkers() {
    return runtimeScheduler.listWorkers();
  }
}

export const taskOrchestrator = new TaskOrchestrator();
