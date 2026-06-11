
import fs from 'node:fs';
import path from 'node:path';

const STORE_DIR = path.resolve('data/nerve-store');
const STORE_PATH = path.join(STORE_DIR, 'state.json');
const CONFIG_ROOT = path.resolve('data/workspace-config');

const DEFAULT_STATE = {
  sessions: [
    {
      key: 'agent:main:main',
      sessionKey: 'agent:main:main',
      label: '主会话',
      displayName: '主会话',
      state: 'IDLE',
      model: 'anthropic/claude-sonnet-4',
      thinking: 'medium',
      updatedAt: Date.now(),
      parentSessionKey: null,
    },
  ],
  messages: {
    'agent:main:main': [
      {
        role: 'assistant',
        content: '我已经接入 Nerve 中文面板。你在这里发任务，我会把它转给执行层。',
        timestamp: Date.now(),
      },
    ],
  },
  memories: [
    { type: 'section', text: '项目记忆' },
    { type: 'item', text: 'Super Hermes 融合面板已就绪。' },
  ],
  crons: [],
  cronRuns: {},
  kanbanTasks: [],
  workspaceFiles: {},
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function ensureStore() {
  ensureDir(STORE_DIR);
  ensureDir(CONFIG_ROOT);
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_STATE, null, 2), 'utf-8');
  }
}

export function loadState() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveState(state) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

export function mutateState(mutator) {
  const state = loadState();
  const result = mutator(state) ?? state;
  saveState(result);
  return result;
}

export function getMainSession() {
  const state = loadState();
  return state.sessions[0];
}

export function listSessions() {
  return loadState().sessions;
}

export function getMessages(sessionKey = 'agent:main:main') {
  const state = loadState();
  return state.messages[sessionKey] || [];
}

export function appendMessage(sessionKey, message) {
  return mutateState((state) => {
    state.messages[sessionKey] ||= [];
    state.messages[sessionKey].push(message);
    const session = state.sessions.find((s) => s.key === sessionKey || s.sessionKey === sessionKey);
    if (session) {
      session.updatedAt = Date.now();
      if (message.role === 'assistant') session.state = 'DONE';
      if (message.role === 'user') session.state = 'THINKING';
    }
    return state;
  });
}

export function upsertSession(session) {
  return mutateState((state) => {
    const idx = state.sessions.findIndex((s) => s.key === session.key || s.sessionKey === session.sessionKey);
    if (idx >= 0) state.sessions[idx] = { ...state.sessions[idx], ...session, updatedAt: Date.now() };
    else state.sessions.unshift({ ...session, updatedAt: Date.now() });
    return state;
  });
}

export function resetSession(sessionKey) {
  return mutateState((state) => {
    state.messages[sessionKey] = [];
    const session = state.sessions.find((s) => s.key === sessionKey || s.sessionKey === sessionKey);
    if (session) session.state = 'IDLE';
    return state;
  });
}

export function deleteSession(sessionKey) {
  return mutateState((state) => {
    if (sessionKey === 'main') return state;
    state.sessions = state.sessions.filter((s) => s.key !== sessionKey && s.sessionKey !== sessionKey);
    delete state.messages[sessionKey];
    return state;
  });
}

export function getMemories() {
  return loadState().memories;
}

export function addMemory(text, section = '', category = 'other') {
  return mutateState((state) => {
    if (section && !state.memories.find((m) => m.type === 'section' && m.text === section)) {
      state.memories.push({ type: 'section', text: section });
    }
    state.memories.push({ type: 'item', text, category });
    return state;
  }).memories;
}

export function deleteMemory(query) {
  return mutateState((state) => {
    state.memories = state.memories.filter((m) => m.text !== query);
    return state;
  }).memories;
}

export function listCrons() {
  return loadState().crons;
}

export function saveCron(job) {
  return mutateState((state) => {
    const id = job.id || `cron-${Date.now()}`;
    const normalized = {
      id,
      name: job.name || job.label || '未命名定时任务',
      label: job.label || job.name || '未命名定时任务',
      enabled: job.enabled ?? true,
      schedule: job.schedule || { kind: 'every', everyMs: 3600000 },
      payload: job.payload || { kind: 'agentTurn', message: '定时任务' },
      state: job.state || {},
      delivery: job.delivery || { mode: 'origin' },
      sessionTarget: job.sessionTarget || 'agent:main:main',
      sessionKey: job.sessionKey || 'agent:main:main',
    };
    const idx = state.crons.findIndex((c) => c.id === id);
    if (idx >= 0) state.crons[idx] = { ...state.crons[idx], ...normalized };
    else state.crons.unshift(normalized);
    state.cronRuns[id] ||= [];
    return state;
  }).crons;
}

export function toggleCron(id, enabled) {
  return mutateState((state) => {
    const job = state.crons.find((c) => c.id === id);
    if (job) job.enabled = enabled;
    return state;
  }).crons;
}

export function runCron(id) {
  return mutateState((state) => {
    const job = state.crons.find((c) => c.id === id);
    if (job) {
      job.state ||= {};
      job.state.lastRunAtMs = Date.now();
      job.state.lastStatus = 'success';
      state.cronRuns[id] ||= [];
      state.cronRuns[id].unshift({ timestamp: new Date().toISOString(), status: 'success', summary: job.label || job.name || id });
    }
    return state;
  });
}

export function deleteCron(id) {
  return mutateState((state) => {
    state.crons = state.crons.filter((c) => c.id !== id);
    delete state.cronRuns[id];
    return state;
  });
}

export function listCronRuns(id) {
  return loadState().cronRuns[id] || [];
}

export function listKanbanTasks() {
  return loadState().kanbanTasks;
}

export function saveKanbanTask(task) {
  return mutateState((state) => {
    const id = task.id || `task-${Date.now()}`;
    const now = Date.now();
    const normalized = {
      id,
      title: task.title || '未命名任务',
      description: task.description || '',
      status: task.status || 'todo',
      priority: task.priority || 'normal',
      createdBy: task.createdBy || 'operator',
      createdAt: task.createdAt || now,
      updatedAt: now,
      version: (task.version || 0) + 1,
      assignee: task.assignee || '',
      labels: task.labels || [],
      columnOrder: task.columnOrder ?? 0,
      feedback: task.feedback || [],
      model: task.model || 'anthropic/claude-sonnet-4',
      thinking: task.thinking || 'medium',
      run: task.run,
      result: task.result,
      resultAt: task.resultAt,
    };
    const idx = state.kanbanTasks.findIndex((t) => t.id === id);
    if (idx >= 0) state.kanbanTasks[idx] = { ...state.kanbanTasks[idx], ...normalized };
    else state.kanbanTasks.unshift(normalized);
    return state;
  }).kanbanTasks;
}

export function deleteKanbanTask(id) {
  return mutateState((state) => {
    state.kanbanTasks = state.kanbanTasks.filter((t) => t.id !== id);
    return state;
  }).kanbanTasks;
}

export function getWorkspaceFilePath(key) {
  const map = {
    soul: 'SOUL.md',
    tools: 'TOOLS.md',
    identity: 'IDENTITY.md',
    user: 'USER.md',
    agents: 'AGENTS.md',
    heartbeat: 'HEARTBEAT.md',
    chatPathLinks: 'CHAT_PATH_LINKS.json',
  };
  return path.join(CONFIG_ROOT, map[key] || `${key}.md`);
}

export function readWorkspaceFile(key) {
  const filePath = getWorkspaceFilePath(key);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

export function writeWorkspaceFile(key, content) {
  ensureDir(CONFIG_ROOT);
  const filePath = getWorkspaceFilePath(key);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}
