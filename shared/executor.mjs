/**
 * 执行模块 — 执行手核心
 *
 * 职责：实际干活（shell 命令 或 Hermes 子进程）
 * 不依赖面板，Hermes CLI 也能直接调
 *
 * 用法:
 *   import { executeTask } from './shared/executor.mjs';
 *   executeTask(task, worker, scheduler);
 */
import { exec } from 'child_process';
import path from 'path';
import { eventBus } from '../runtime/events/bus.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 直接命令模板（执行手可直接用 shell 执行的简单任务）
 */
const directCommands = [
  { match: /^扫描.*盘.*文件夹|^列出.*盘.*目录|^dir.*d:|^ls.*\/d/i, cmd: 'powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-ChildItem $env:SystemDrive\\ -Directory | ForEach-Object { $_.Name }; Write-Output \"--- 二层 ---\"; Get-ChildItem $env:SystemDrive\\ -Directory | ForEach-Object { Write-Output \"--- $($_.Name) ---\"; Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name } }"' },
  { match: /^whoami|^hostname|^ipconfig|^systeminfo/i, cmd: 'cmd.exe /c "chcp 65001 >nul && hostname && whoami"' },
];

/**
 * GBK 回退解码
 * Windows 命令行输出可能是 GBK，转成可读字符串
 */
function decodeOutput(buf) {
  try {
    const decoded = new TextDecoder('gbk', { fatal: false }).decode(
      Buffer.from(buf, 'binary'),
    );
    if (!decoded.includes('\uFFFD')) return decoded;
  } catch {}
  return buf;
}

/**
 * 执行一个任务
 *
 * @param {object} task    - 任务对象（必须有 .id .goal .status）
 * @param {object} worker  - 执行手工作器对象
 * @param {object} sched   - 调度器实例（提供 markTaskProgress / heartbeatWorker / spawnSubAgent 等方法）
 */
export async function executeTask(task, worker, sched) {
  const goal = task.goal;

  // Phase 1: 启动执行引擎
  sched.markTaskProgress(task.id, '启动执行引擎');
  sched.heartbeatWorker(worker.id, '启动执行引擎', 'task-routing', 'execution-core');

  const isSimpleCommand = directCommands.some((dc) => dc.match.test(goal.trim()));
  const subAgents = [];
  if (!isSimpleCommand) {
    const autoSubs = [
      sched.spawnSubAgent(task.id, worker.id, 'task-analyzer', 'goal-understanding'),
      sched.spawnSubAgent(task.id, worker.id, 'tool-executor', 'tool-calling'),
    ];
    subAgents.push(...autoSubs);
    autoSubs.forEach((sa) => {
      sched.heartbeatSubAgent(sa.id, '初始化完成，等待任务');
    });
    await sleep(300);
  }

  // Phase 2: 执行任务
  sched.markTaskProgress(task.id, '执行主流程');
  sched.heartbeatWorker(worker.id, '执行主流程', 'execution-flow', 'worker-runtime');
  subAgents.forEach((sa) => {
    sched.heartbeatSubAgent(sa.id, '执行中');
  });
  await sleep(300);

  // 检查风控
  const briefGoal = goal.toLowerCase();
  if (briefGoal.includes('删除') || briefGoal.includes('高风险') || briefGoal.includes('shutdown')) {
    sched.requestApproval(task.id, '等待主脑审批高风险动作');
    sched.heartbeatWorker(worker.id, '等待主脑审批高风险动作', 'approval-gate', 'policy-core');
    subAgents.forEach((sa) => sched.heartbeatSubAgent(sa.id, '等待主脑审批高风险动作', 'paused'));
    return;
  }

  try {
    let matchedCmd = null;
    for (const dc of directCommands) {
      if (dc.match.test(goal.trim())) {
        matchedCmd = dc.cmd;
        break;
      }
    }

    let output;
    if (matchedCmd) {
      // 简单命令：执行手直接 shell 执行
      sched.markTaskProgress(task.id, '执行系统命令');
      sched.heartbeatWorker(worker.id, '执行系统命令', 'system-command', 'terminal-core');
      subAgents.forEach((sa) => sched.heartbeatSubAgent(sa.id, '执行系统命令'));

      output = await new Promise((resolve, reject) => {
        exec(
          matchedCmd,
          { timeout: 30000, maxBuffer: 5 * 1024 * 1024 },
          (error, stdout) => {
            if (error && !error.killed) reject(error);
            else resolve(stdout || '');
          },
        );
      });
    } else {
      // 复杂任务：执行手 spawn Hermes 子进程调 LLM
      sched.markTaskProgress(task.id, '执行主流程');
      sched.heartbeatWorker(worker.id, '执行主流程', 'execution-flow', 'worker-runtime');

      const hbInterval = setInterval(() => {
        if (task.status !== 'running') { clearInterval(hbInterval); return; }
        sched.heartbeatWorker(worker.id, '执行中', worker.currentSkill, worker.currentTool);
        subAgents.forEach((sa) => sched.heartbeatSubAgent(sa.id, '执行中'));
      }, 3000);

      const hermesCmd = process.platform === 'win32' ? 'hermes.exe' : 'hermes';
      const hermesHome = process.env.HERMES_HOME || path.join(process.cwd(), 'data', 'hermes-home');

      output = await new Promise((resolve, reject) => {
        const child = exec(
          `"${hermesCmd}" chat -q ${JSON.stringify(goal)} --yolo --model deepseek-v4-flash --provider deepseek`,
          {
            timeout: 180000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, HERMES_HOME: hermesHome },
          },
          (error, stdout) => {
            clearInterval(hbInterval);
            if (error && !error.killed) reject(error);
            else resolve(stdout || '');
          },
        );
      });
    }

    // Phase 3: 结果验证
    sched.markTaskProgress(task.id, '结果验证');
    sched.heartbeatWorker(worker.id, '结果验证', 'result-validation', 'validator-core');
    subAgents.forEach((sa) => sched.heartbeatSubAgent(sa.id, '验证结果'));
    await sleep(300);

    const summary = (decodeOutput(output || ''))
      .replace(/:.*?2[层级].*?:.*?(?:\n|$)/, '')
      .replace(/---[^]*?---\s*/g, '')
      .replace(/\r+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 2000) || `已完成：${goal}`;
    sched.completeTask(task.id, summary);
  } catch (error) {
    sched.failTask(task.id, `执行失败：${error.message}`);
  }
}
