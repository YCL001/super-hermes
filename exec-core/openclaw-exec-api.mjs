import fs from 'node:fs';
import path from 'node:path';
import { runtimeScheduler } from '../runtime/scheduler/index.mjs';
import { loadLocalConfig } from '../shared/local-paths.mjs';

function scanCapabilities() {
  const config = loadLocalConfig();
  const reusedDir = config.paths.openclaw_review;
  const skillsFile = path.join(reusedDir, 'openclaw-skills.ts');
  const skillsContent = fs.existsSync(skillsFile) ? fs.readFileSync(skillsFile, 'utf-8') : '';

  const capabilities = [
    {
      id: 'browser-automation',
      kind: 'exec-skill',
      source: 'openclaw',
      description: '浏览器自动化执行能力',
    },
    {
      id: 'file-edit',
      kind: 'exec-skill',
      source: 'openclaw',
      description: '文件修改与补丁执行能力',
    },
    {
      id: 'debug-retry',
      kind: 'exec-skill',
      source: 'openclaw',
      description: '局部失败重试与排障能力',
    },
  ];

  return {
    capabilities,
    reusedSkillScannerDetected: skillsContent.includes('SKILL.md') && skillsContent.includes('walkSkillDirs'),
  };
}

export function getExecCapabilities() {
  return scanCapabilities();
}

export function approveExecTask(taskId) {
  const task = runtimeScheduler.approveTask(taskId);
  if (task.status === 'running') {
    setTimeout(() => {
      runtimeScheduler.markTaskProgress(taskId, '继续执行审批后步骤');
      runtimeScheduler.completeTask(taskId, `已完成：${task.goal}`);
    }, 600);
  }
  return task;
}

export function rejectExecTask(taskId, reason = '主脑拒绝执行') {
  return runtimeScheduler.rejectTask(taskId, reason);
}

export function getExecTask(taskId) {
  return runtimeScheduler.getTask(taskId);
}

export function listExecSubAgents(taskId = null) {
  return runtimeScheduler.listSubAgents(taskId);
}
