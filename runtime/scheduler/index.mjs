import { eventBus } from '../events/bus.mjs';
import { choosePoolForStage } from '../../control-core/model-pool-loader.mjs';
import { executeTask } from '../../shared/executor.mjs';

export class RuntimeScheduler {
  constructor(maxConcurrentWorkers = 2) {
    this.tasks = new Map();
    this.workers = new Map();
    this.subAgents = new Map();
    this.maxConcurrentWorkers = maxConcurrentWorkers;
    this.queue = [];
  }

  createTask(input) {
    const now = new Date().toISOString();
    const task = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      goal: input.goal,
      status: 'queued',
      priority: input.priority ?? 5,
      constraints: input.constraints ?? [],
      createdAt: now,
      updatedAt: now,
      currentStep: 'queued',
      plannerPool: input.plannerPool,
      attemptCount: 0,
      requiresApproval: false,
      approvalDecision: 'pending',
      availableCapabilities: input.availableCapabilities ?? [],
    };

    this.tasks.set(task.id, task);
    this.queue.push(task.id);
    eventBus.publish('task.created', task);
    this.schedule();
    return task;
  }

  /**
   * 阻塞等待任务完成，返回最终结果
   */
  waitForTask(taskId, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const task = this.tasks.get(taskId);
      if (!task) return reject(new Error('任务不存在'));
      if (['completed', 'failed', 'cancelled'].includes(task.status)) {
        return resolve(task);
      }
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`等待任务超时 ${timeoutMs}ms`));
      }, timeoutMs);
      const unsubscribe = eventBus.subscribe('task.completed', (e) => {
        if (e.payload.id === taskId) {
          clearTimeout(timer);
          resolve(e.payload);
        }
      });
      eventBus.subscribe('task.failed', (e) => {
        if (e.payload.id === taskId) {
          clearTimeout(timer);
          resolve(e.payload);
        }
      });
    });
  }

  listTasks() {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listWorkers() {
    return Array.from(this.workers.values()).sort((a, b) => {
      const slotA = a.slot ?? 999;
      const slotB = b.slot ?? 999;
      if (slotA !== slotB) return slotA - slotB;
      return (b.lastHeartbeatAt || '').localeCompare(a.lastHeartbeatAt || '');
    });
  }

  listSubAgents(taskId = null) {
    const all = Array.from(this.subAgents.values()).sort((a, b) => (b.lastHeartbeatAt || '').localeCompare(a.lastHeartbeatAt || ''));
    return taskId ? all.filter((item) => item.taskId === taskId) : all;
  }

  getTask(taskId) {
    const task = this.requireTask(taskId);
    return {
      ...task,
      workers: this.listWorkers().filter((worker) => worker.taskId === taskId),
      subAgents: this.listSubAgents(taskId),
    };
  }

  schedule() {
    while (this.activeWorkerCount() < this.maxConcurrentWorkers && this.queue.length > 0) {
      const taskId = this.queue.shift();
      this.startTask(taskId);
    }
  }

  startTask(taskId) {
    const task = this.requireTask(taskId);
    if (task.status !== 'queued') return task;

    task.status = 'running';
    task.updatedAt = new Date().toISOString();
    task.currentStep = 'worker assigned';

    const worker = this.attachWorker(task);
    eventBus.publish('task.started', { task, worker });
    executeTask(task, worker, this);
    return task;
  }

  markTaskProgress(taskId, step) {
    const task = this.requireTask(taskId);
    task.currentStep = step;
    task.updatedAt = new Date().toISOString();
    eventBus.publish('task.progress', task);
    return task;
  }

  completeTask(taskId, resultSummary) {
    const task = this.requireTask(taskId);
    task.status = 'completed';
    task.resultSummary = resultSummary;
    task.updatedAt = new Date().toISOString();
    eventBus.publish('task.completed', task);
    this.stopWorkersForTask(taskId, 'completed');
    this.stopSubAgentsForTask(taskId, 'completed');
    this.schedule();
    return task;
  }

  failTask(taskId, resultSummary) {
    const task = this.requireTask(taskId);
    task.status = 'failed';
    task.resultSummary = resultSummary;
    task.updatedAt = new Date().toISOString();
    eventBus.publish('task.failed', task);
    this.stopWorkersForTask(taskId, 'failed');
    this.stopSubAgentsForTask(taskId, 'failed');
    this.schedule();
    return task;
  }

  requestApproval(taskId, step) {
    const task = this.requireTask(taskId);
    task.status = 'waiting_approval';
    task.currentStep = step;
    task.updatedAt = new Date().toISOString();
    task.requiresApproval = true;
    task.approvalDecision = 'pending';
    task.approvalPool = choosePoolForStage('approval');
    eventBus.publish('task.waiting_approval', task);
    this.updateWorkersForTask(taskId, {
      status: 'waiting_approval',
      currentStep: step,
      currentPool: task.approvalPool,
      lastHeartbeatAt: new Date().toISOString(),
    });
    this.updateSubAgentsForTask(taskId, {
      status: 'paused',
      currentStep: step,
      lastHeartbeatAt: new Date().toISOString(),
    });
    return task;
  }

  approveTask(taskId) {
    const task = this.requireTask(taskId);
    if (task.status !== 'waiting_approval') return task;
    task.status = 'running';
    task.currentStep = 'approval granted';
    task.updatedAt = new Date().toISOString();
    task.approvalDecision = 'approved';
    eventBus.publish('task.progress', task);
    this.updateWorkersForTask(taskId, {
      status: 'running',
      currentStep: 'approval granted',
      lastHeartbeatAt: new Date().toISOString(),
    });
    this.updateSubAgentsForTask(taskId, {
      status: 'running',
      currentStep: 'approval granted',
      lastHeartbeatAt: new Date().toISOString(),
    });
    return task;
  }

  rejectTask(taskId, reason = '主脑拒绝执行') {
    const task = this.requireTask(taskId);
    task.status = 'cancelled';
    task.currentStep = 'approval rejected';
    task.updatedAt = new Date().toISOString();
    task.approvalDecision = 'rejected';
    task.resultSummary = reason;
    eventBus.publish('task.failed', task);
    this.stopWorkersForTask(taskId, 'failed');
    this.stopSubAgentsForTask(taskId, 'failed');
    this.schedule();
    return task;
  }

  heartbeatWorker(workerId, step, skill, tool) {
    const worker = this.requireWorker(workerId);
    worker.lastHeartbeatAt = new Date().toISOString();
    if (step) worker.currentStep = step;
    if (skill) worker.currentSkill = skill;
    if (tool) worker.currentTool = tool;
    eventBus.publish('worker.heartbeat', worker);
    return worker;
  }

  spawnSubAgent(taskId, workerId, role, skill) {
    const worker = this.requireWorker(workerId);
    const subAgent = {
      id: crypto.randomUUID(),
      taskId,
      workerId,
      workerSlot: worker.slot ?? null,
      role,
      skill,
      status: 'starting',
      currentStep: 'booting',
      lastHeartbeatAt: new Date().toISOString(),
    };
    this.subAgents.set(subAgent.id, subAgent);
    eventBus.publish('subagent.started', subAgent);
    subAgent.status = 'running';
    subAgent.currentStep = 'accepted sub-task';
    subAgent.lastHeartbeatAt = new Date().toISOString();
    return subAgent;
  }

  heartbeatSubAgent(subAgentId, step, status = 'running') {
    const subAgent = this.requireSubAgent(subAgentId);
    subAgent.status = status;
    subAgent.currentStep = step;
    subAgent.lastHeartbeatAt = new Date().toISOString();
    eventBus.publish('subagent.heartbeat', subAgent);
    return subAgent;
  }

  activeWorkerCount() {
    return Array.from(this.workers.values()).filter((worker) =>
      ['starting', 'running', 'waiting_approval'].includes(worker.status),
    ).length;
  }

  pickWorkerSlot() {
    const activeSlots = new Set(
      Array.from(this.workers.values())
        .filter((worker) => ['starting', 'running', 'waiting_approval'].includes(worker.status))
        .map((worker) => worker.slot)
        .filter(Boolean),
    );
    for (let slot = 1; slot <= this.maxConcurrentWorkers; slot += 1) {
      if (!activeSlots.has(slot)) return slot;
    }
    return 1;
  }

  attachWorker(task) {
    const workerPool = choosePoolForStage('execution', task.attemptCount);
    const slot = this.pickWorkerSlot();
    const worker = {
      id: crypto.randomUUID(),
      taskId: task.id,
      role: 'executor',
      slot,
      status: 'starting',
      currentStep: 'booting',
      lastHeartbeatAt: new Date().toISOString(),
      currentSkill: 'task-routing',
      currentTool: 'runtime-scheduler',
      currentPool: workerPool,
    };

    this.workers.set(worker.id, worker);
    task.workerPool = workerPool;
    task.workerSlot = slot;
    eventBus.publish('worker.started', worker);

    worker.status = 'running';
    worker.currentStep = 'accepted task';
    worker.lastHeartbeatAt = new Date().toISOString();
    return worker;
  }

  stopWorkersForTask(taskId, endState) {
    for (const worker of this.workers.values()) {
      if (worker.taskId !== taskId) continue;
      worker.status = endState === 'completed' ? 'completed' : 'failed';
      worker.currentStep = endState;
      worker.lastHeartbeatAt = new Date().toISOString();
      eventBus.publish('worker.stopped', worker);
    }
  }

  stopSubAgentsForTask(taskId, endState) {
    for (const subAgent of this.subAgents.values()) {
      if (subAgent.taskId !== taskId) continue;
      subAgent.status = endState === 'completed' ? 'completed' : 'failed';
      subAgent.currentStep = endState;
      subAgent.lastHeartbeatAt = new Date().toISOString();
      eventBus.publish('subagent.stopped', subAgent);
    }
  }

  updateWorkersForTask(taskId, patch) {
    for (const worker of this.workers.values()) {
      if (worker.taskId !== taskId) continue;
      Object.assign(worker, patch);
      eventBus.publish('worker.heartbeat', worker);
    }
  }

  updateSubAgentsForTask(taskId, patch) {
    for (const subAgent of this.subAgents.values()) {
      if (subAgent.taskId !== taskId) continue;
      Object.assign(subAgent, patch);
      eventBus.publish('subagent.heartbeat', subAgent);
    }
  }

  /**
   * 执行任务 — 委托给 shared/executor.mjs
   * 执行手逻辑不耦合面板，Hermes CLI 也可直接调用 executor
   */
  async simulateExecution(task, worker) {
    return executeTask(task, worker, this);
  }

  requireTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  requireWorker(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Worker not found: ${workerId}`);
    return worker;
  }

  requireSubAgent(subAgentId) {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) throw new Error(`SubAgent not found: ${subAgentId}`);
    return subAgent;
  }
}

export const runtimeScheduler = new RuntimeScheduler();
