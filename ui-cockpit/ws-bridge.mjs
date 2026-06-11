import { WebSocketServer } from 'ws';
import { hermesOpenclawFusion } from '../unified-agent.mjs';
import { getRuntimeSnapshot } from '../adapters/hermes/nonblocking-entry.mjs';
import { getExecCapabilities } from '../exec-core/openclaw-exec-api.mjs';
import { eventBus } from '../runtime/events/bus.mjs';
import { listSessions, getMessages, appendMessage, upsertSession, resetSession, deleteSession } from './local-store.mjs';

const MAIN_SESSION_KEY = 'agent:main:main';

function res(id, ok, payload, error) {
  return JSON.stringify({ type: 'res', id, ok, payload, error });
}

function evt(event, payload) {
  return JSON.stringify({ type: 'event', event, payload });
}

function now() {
  return Date.now();
}

function ensureSession(sessionKey = MAIN_SESSION_KEY) {
  const existing = listSessions().find((s) => s.key === sessionKey || s.sessionKey === sessionKey);
  if (existing) return existing;
  const stateLabel = sessionKey === MAIN_SESSION_KEY ? '主会话' : sessionKey.includes('worker-1') ? '1号执行手' : sessionKey.includes('worker-2') ? '2号执行手' : `会话 ${sessionKey}`;
  const created = {
    key: sessionKey,
    sessionKey,
    label: stateLabel,
    displayName: stateLabel,
    state: 'IDLE',
    model: 'anthropic/claude-sonnet-4',
    thinking: 'medium',
    updatedAt: now(),
  };
  upsertSession(created);
  return created;
}

function buildSessionPayload(limit = 200) {
  const sessions = listSessions().slice(0, limit);
  return {
    sessions,
    currentSession: sessions[0]?.key || MAIN_SESSION_KEY,
    agentName: 'Hermes + OpenClaw Fusion',
    total: sessions.length,
  };
}

function buildChatHistory(sessionKey, limit = 200) {
  const messages = getMessages(sessionKey).slice(-limit);
  return { sessionKey, messages };
}

function createAssistantReply(message, taskResult) {
  const text = `已收到任务：${message}\n\n我已经把它转给执行层。任务编号：${taskResult.taskId || 'pending'}。`;
  return {
    role: 'assistant',
    content: text,
    timestamp: now(),
  };
}

function buildTaskResultPayload(task) {
  return {
    taskId: task.id,
    sessionId: task.sessionId || MAIN_SESSION_KEY,
    status: task.status,
    goal: task.goal || '未命名任务',
    workerSlot: task.workerSlot || null,
    resultSummary: (task.resultSummary || '').trim(),
    updatedAt: task.updatedAt || new Date().toISOString(),
  };
}

export function setupWsBridge(httpServer) {
  const clients = new Set();
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const broadcast = (message) => {
    for (const client of clients) {
      if (client.readyState === 1) client.send(message);
    }
  };

  const pushTaskResultToSession = (task) => {
    const sessionKey = task.sessionId || MAIN_SESSION_KEY;
    const session = ensureSession(sessionKey);
    const resultPayload = buildTaskResultPayload(task);
    upsertSession({
      ...session,
      key: sessionKey,
      sessionKey,
      state: task.status === 'completed' ? 'DONE' : 'ERROR',
      updatedAt: now(),
      lastTaskResult: resultPayload,
    });
    // 只发内部任务结果事件，不把原始结果直接塞进聊天/终端界面
    broadcast(evt('task.result', resultPayload));
    broadcast(evt('agent', {
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'end', taskId: task.id, status: task.status },
      state: task.status === 'completed' ? 'idle' : 'error',
    }));
  };

  eventBus.subscribe('task.completed', (e) => pushTaskResultToSession(e.payload));
  eventBus.subscribe('task.failed', (e) => pushTaskResultToSession(e.payload));

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'event', event: 'connect.challenge', data: { minProtocol: 4, maxProtocol: 4 } }));
    let connected = false;

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type !== 'req') return;
      const { id, method, params = {} } = msg;

      if (method === 'connect') {
        connected = true;
        ensureSession(MAIN_SESSION_KEY);
        ws.send(res(id, true, {
          sessionId: `fusion-${Date.now()}`,
          agentName: 'Hermes + OpenClaw Fusion',
          protocol: 4,
          server: { version: '0.0.1', name: 'Hermes + OpenClaw Fusion' },
          features: ['tool-events', 'approvals', 'tasks', 'chat', 'workspace'],
          model: 'anthropic/claude-sonnet-4',
          defaultModel: 'anthropic/claude-sonnet-4',
        }));
        ws.send(evt('connect.ready', { message: '连接成功' }));
        ws.send(evt('agent', { sessionKey: MAIN_SESSION_KEY, stream: 'lifecycle', data: { phase: 'end' }, state: 'idle' }));
        return;
      }

      if (!connected && method !== 'ping') {
        ws.send(res(id, false, null, { message: 'Not connected' }));
        return;
      }

      switch (method) {
        case 'ping':
          ws.send(res(id, true, { pong: true }));
          return;
        case 'server.info':
          ws.send(res(id, true, hermesOpenclawFusion.getOverview()));
          return;
        case 'server.modelRouting':
          ws.send(res(id, true, hermesOpenclawFusion.getModelRouting()));
          return;
        case 'sessions.list':
          ws.send(res(id, true, buildSessionPayload(params.limit || 200)));
          return;
        case 'sessions.patch': {
          const sessionKey = params.key || MAIN_SESSION_KEY;
          const session = ensureSession(sessionKey);
          upsertSession({
            ...session,
            key: sessionKey,
            sessionKey,
            model: params.model || session.model,
            thinking: params.thinkingLevel || session.thinking,
            label: params.label || session.label,
            displayName: params.label || session.displayName,
            state: session.state || 'IDLE',
          });
          ws.send(res(id, true, { ok: true }));
          broadcast(evt('agent', { sessionKey, stream: 'lifecycle', data: { phase: 'end' }, state: 'idle' }));
          return;
        }
        case 'sessions.reset': {
          const sessionKey = params.key || MAIN_SESSION_KEY;
          resetSession(sessionKey);
          ws.send(res(id, true, { ok: true }));
          broadcast(evt('chat', { sessionKey, state: 'final', messages: [] }));
          return;
        }
        case 'sessions.delete':
          deleteSession(params.key || '');
          ws.send(res(id, true, { ok: true }));
          return;
        case 'agents.create': {
          const sessionKey = `agent:main:subagent:${Date.now()}`;
          upsertSession({
            key: sessionKey,
            sessionKey,
            label: params.name || '新会话',
            displayName: params.name || '新会话',
            parentSessionKey: MAIN_SESSION_KEY,
            state: 'IDLE',
            model: 'anthropic/claude-sonnet-4',
            thinking: 'medium',
            updatedAt: now(),
          });
          ws.send(res(id, true, { ok: true, key: sessionKey, sessionKey }));
          return;
        }
        case 'chat.history': {
          const sessionKey = params.sessionKey || MAIN_SESSION_KEY;
          ws.send(res(id, true, buildChatHistory(sessionKey, params.limit || 200)));
          return;
        }
        case 'chat.abort': {
          const sessionKey = params.sessionKey || MAIN_SESSION_KEY;
          ws.send(res(id, true, { ok: true }));
          broadcast(evt('chat', { sessionKey, state: 'aborted', message: '已中止' }));
          return;
        }
        case 'chat.send': {
          const sessionKey = params.sessionKey || MAIN_SESSION_KEY;
          const message = params.message || '';
          const session = ensureSession(sessionKey);
          upsertSession({ ...session, state: 'THINKING', updatedAt: now() });
          const userMessage = { role: 'user', content: message, timestamp: now() };
          appendMessage(sessionKey, userMessage);
          broadcast(evt('chat', { sessionKey, state: 'started', messages: [userMessage] }));
          const taskResult = hermesOpenclawFusion.submitGoal(sessionKey, message || '未命名任务');
          const assistant = createAssistantReply(message, taskResult);
          appendMessage(sessionKey, assistant);
          upsertSession({ ...session, key: sessionKey, sessionKey, state: 'EXECUTING', updatedAt: now() });
          ws.send(res(id, true, { runId: taskResult.taskId || `run-${Date.now()}`, status: 'ok', sessionKey }));
          broadcast(evt('chat', { sessionKey, state: 'streaming', messages: [assistant] }));
          broadcast(evt('agent', { sessionKey, stream: 'lifecycle', data: { phase: 'task-submitted', taskId: taskResult.taskId }, state: 'busy' }));
          return;
        }
        case 'tasks.list':
          ws.send(res(id, true, { tasks: getRuntimeSnapshot().tasks }));
          return;
        case 'exec.capabilities':
          ws.send(res(id, true, getExecCapabilities()));
          return;
        default:
          ws.send(res(id, true, { ok: true, method, params }));
      }
    });

    ws.on('close', () => clients.delete(ws));
  });

  console.log('[ws-bridge] WebSocket gateway ready at /ws');
}
