import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { hermesOpenclawFusion } from '../unified-agent.mjs';
import { getRuntimeSnapshot } from '../adapters/hermes/nonblocking-entry.mjs';
import { getExecCapabilities, approveExecTask, rejectExecTask, getExecTask, listExecSubAgents } from '../exec-core/openclaw-exec-api.mjs';
import { loadLocalConfig } from '../shared/local-paths.mjs';
import { setupWsBridge } from './ws-bridge.mjs';
import {
  ensureStore, loadState, saveState, listSessions, getMessages, appendMessage, upsertSession,
  resetSession, deleteSession, getMemories, addMemory, deleteMemory, listCrons, saveCron,
  toggleCron, runCron, deleteCron, listCronRuns, listKanbanTasks, saveKanbanTask,
  deleteKanbanTask, readWorkspaceFile, writeWorkspaceFile
} from './local-store.mjs';

const LOCAL_CONFIG = loadLocalConfig();
const PORT = LOCAL_CONFIG.ports.fusion_panel;
const NERVE_DIST = path.resolve('reused/nerve-shell/dist');
const COCKPIT_HOME = path.resolve('ui-cockpit/office-status.html');
const PROJECT_DIR = path.resolve('.');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
};

ensureStore();

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function withinProject(target) {
  return target.startsWith(PROJECT_DIR);
}

function relPath(p) {
  return '/' + path.relative(PROJECT_DIR, p).replace(/\\/g, '/');
}

function scanDir(dir, showHidden, depth) {
  if (depth <= 0) return null;
  try {
    if (!withinProject(dir)) return [];
    const items = fs.readdirSync(dir, { withFileTypes: true });
    return items
      .filter((entry) => showHidden || !entry.name.startsWith('.'))
      .map((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: relPath(fullPath),
            type: 'directory',
            size: undefined,
            children: scanDir(fullPath, showHidden, depth - 1),
          };
        }
        return {
          name: entry.name,
          path: relPath(fullPath),
          type: 'file',
          size: fs.statSync(fullPath).size,
        };
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-CN');
      });
  } catch {
    return [];
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function buildModels() {
  const routing = hermesOpenclawFusion.getModelRouting();
  const models = [];
  if (routing.pools) {
    for (const [role, pool] of Object.entries(routing.pools)) {
      models.push({
        id: `${pool.provider}/${pool.model}`,
        label: pool.model,
        provider: pool.provider,
        role: role === 'brain' ? 'primary' : 'allowed',
        configured: true,
        alias: pool.role,
      });
    }
  }
  return models;
}

function buildSkills() {
  const root = path.resolve('data/hermes-home/skills');
  const skills = [];
  if (!fs.existsSync(root)) return skills;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'SKILL.md') {
        const rel = path.relative(root, path.dirname(full)).replace(/\\/g, '/');
        const content = fs.readFileSync(full, 'utf-8');
        const descMatch = content.match(/description:\s*"?([^"\n]+)"?/);
        const name = rel.split('/').pop() || rel;
        skills.push({
          name,
          description: descMatch?.[1] || '本地技能',
          emoji: '🧩',
          eligible: true,
          disabled: false,
          blockedByAllowlist: false,
          source: 'workspace',
          bundled: false,
        });
      }
    }
  };
  walk(root);
  return skills.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function buildServerInfo() {
  return {
    ok: true,
    workspaceRoot: PROJECT_DIR,
    system: 'Hermes',
    mode: 'host-hermes-embedded-openclaw-exec',
    agentName: 'Hermes + OpenClaw Fusion',
    models: buildModels(),
  };
}

function buildKanbanConfig() {
  return {
    columns: [
      { key: 'backlog', title: '收集箱', visible: true },
      { key: 'todo', title: '待办', visible: true },
      { key: 'in-progress', title: '进行中', visible: true },
      { key: 'review', title: '待确认', visible: true },
      { key: 'done', title: '已完成', visible: true },
    ],
    defaults: { status: 'todo', priority: 'normal' },
    reviewRequired: true,
    allowDoneDragBypass: false,
    quickViewLimit: 20,
    proposalPolicy: 'confirm',
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/routing') return json(res, 200, hermesOpenclawFusion.getModelRouting());
    if (pathname === '/api/runtime') return json(res, 200, getRuntimeSnapshot());
    if (pathname === '/api/overview') return json(res, 200, hermesOpenclawFusion.getOverview());
    if (pathname === '/api/exec-capabilities') return json(res, 200, getExecCapabilities());
    if (pathname === '/api/subagents') return json(res, 200, { subAgents: listExecSubAgents(url.searchParams.get('taskId')) });
    if (req.method === 'GET' && pathname.startsWith('/api/tasks/')) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length === 3) return json(res, 200, getExecTask(parts[2]));
    }
    if (req.method === 'POST' && pathname === '/api/switch-hermes-model') {
      const body = await parseBody(req);
      const model = (body.model || '').trim();
      if (!model) return json(res, 400, { error: 'model 必填' });
      const configPath = path.resolve('data/hermes-home/config.yaml');
      try {
        let cfg = fs.readFileSync(configPath, 'utf-8');
        cfg = cfg.replace(/^(default:\s*).+$/m, `$1${model}`);
        fs.writeFileSync(configPath, cfg, 'utf-8');
        return json(res, 200, { ok: true, model, path: configPath });
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }

    if (req.method === 'POST' && pathname === '/api/switch-exec-model') {
      const body = await parseBody(req);
      const model = (body.model || 'deepseek-v4-flash').trim();
      const configPath = path.resolve('data/openclaw-home/openclaw.json');
      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const cfg = JSON.parse(raw);
        // 根据 selected model 匹配对应的 provider 前缀
        const modelProviders = cfg.models?.providers || {};
        let prefix = 'deepseek';
        for (const [pname, pval] of Object.entries(modelProviders)) {
          if (pval.models?.some(m => m.id === model)) { prefix = pname; break; }
        }
        const fullModel = `${prefix}/${model}`;
        if (cfg.agents?.defaults?.model) {
          cfg.agents.defaults.model.primary = fullModel;
        }
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
        return json(res, 200, { ok: true, model: fullModel, path: configPath });
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }

    if (req.method === 'POST' && pathname === '/api/test-hermes-model') {
      const body = await parseBody(req);
      const model = (body.model || 'deepseek-v4-flash').trim();
      const ocPath = path.resolve('data/openclaw-home/openclaw.json');
      try {
        const oc = JSON.parse(fs.readFileSync(ocPath, 'utf-8'));
        const modelProviders = oc.models?.providers || {};
        let providerName = 'deepseek';
        let provider = modelProviders[providerName];
        for (const [pn, pv] of Object.entries(modelProviders)) {
          if (pv.models?.some(m => m.id === model)) {
            providerName = pn;
            provider = pv;
            break;
          }
        }
        if (!provider) return json(res, 200, { ok: false, error: `未找到 ${model} 所属的 provider 配置`, model });
        const baseUrl = (provider.baseUrl || '').replace(/\/+$/, '');
        let apiKey = provider.apiKey || '';
        if (!apiKey) {
          const userHome = process.env.USERPROFILE || process.env.HOME || '';
          const envPaths = [
            path.resolve('data/hermes-home/.env'),
            userHome ? path.join(userHome, 'AppData', 'Local', 'hermes', '.env') : '',
          ];
          for (const ep of envPaths) {
            if (fs.existsSync(ep)) {
              const env = fs.readFileSync(ep, 'utf-8');
              const keyMatch = env.match(/DEEPSEEK_API_KEY=(.+)/);
              if (keyMatch) { apiKey = keyMatch[1].trim(); break; }
            }
          }
        }
        if (!apiKey) apiKey = process.env.DEEPSEEK_API_KEY || '';
        if (!apiKey) return json(res, 200, { ok: false, error: '未找到 API key', model, baseUrl });
        if (!baseUrl) return json(res, 200, { ok: false, error: '未找到 baseUrl', model });
        const url = `${baseUrl}/chat/completions`;
        const testPayload = JSON.stringify({
          model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 2
        });
        const resp = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: testPayload,
        });
        const text = await resp.text();
        if (!resp.ok) {
          return json(res, 200, { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 200)}`, model, baseUrl });
        }
        return json(res, 200, { ok: true, message: `模型 ${model} 正常 (${providerName})`, model, baseUrl });
      } catch (err) {
        return json(res, 200, { ok: false, error: err.message, model });
      }
    }

    if (req.method === 'POST' && pathname === '/api/test-exec-model') {
      const body = await parseBody(req);
      const model = (body.model || 'deepseek-v4-flash').trim();
      const ocPath = path.resolve('data/openclaw-home/openclaw.json');
      try {
        const raw = fs.readFileSync(ocPath, 'utf-8');
        const oc = JSON.parse(raw);
        const modelProviders = oc.models?.providers || {};
        // 根据所选模型查找对应 provider
        let providerName = 'deepseek';
        let provider = modelProviders[providerName];
        for (const [pn, pv] of Object.entries(modelProviders)) {
          if (pv.models?.some(m => m.id === model)) {
            providerName = pn;
            provider = pv;
            break;
          }
        }
        if (!provider) return json(res, 200, { ok: false, error: `未找到 ${model} 所属的 provider 配置`, model });
        const baseUrl = (provider.baseUrl || '').replace(/\/+$/, '');
        const apiKey = provider.apiKey || process.env.DEEPSEEK_API_KEY || '';
        if (!apiKey) return json(res, 200, { ok: false, error: '未找到执行手 API key', model, baseUrl });
        if (!baseUrl) return json(res, 200, { ok: false, error: '未找到 baseUrl', model });
        const url = `${baseUrl}/chat/completions`;
        /* test with the actual model ID, not the short name */
        const testPayload = JSON.stringify({
          model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 2
        });
        const resp = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: testPayload,
        });
        const text = await resp.text();
        if (!resp.ok) {
          return json(res, 200, { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 200)}`, model, baseUrl });
        }
        return json(res, 200, { ok: true, message: `执行手 ${model} 正常 (${providerName})`, model, baseUrl });
      } catch (err) {
        return json(res, 200, { ok: false, error: err.message, model });
      }
    }

    if (req.method === 'POST' && pathname === '/api/restart-gateway') {
      // 启动新进程后再关闭当前进程
      const script = path.resolve('ui-cockpit/server.mjs');
      const newProc = spawn('node', [script], {
        cwd: PROJECT_DIR,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
      });
      newProc.unref();
      // 先给前端响应，再关当前进程
      json(res, 200, { ok: true, message: '网关正在重启…' });
      setTimeout(() => { process.exit(0); }, 500);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/tasks') {
      const body = await parseBody(req);
      if (body.wait) {
        // 阻塞等待任务完成
        return json(res, 200, await hermesOpenclawFusion.submitGoalAndWait(
          'cockpit-session', body.goal || '未命名任务', [], body.timeout || 180000
        ));
      }
      return json(res, 200, hermesOpenclawFusion.submitGoal('cockpit-session', body.goal || '未命名任务'));
    }
    if (req.method === 'POST' && pathname.endsWith('/approve')) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts[0] === 'api' && parts[1] === 'tasks') return json(res, 200, approveExecTask(parts[2]));
    }
    if (req.method === 'POST' && pathname.endsWith('/reject')) {
      const parts = pathname.split('/').filter(Boolean);
      const body = await parseBody(req);
      if (parts[0] === 'api' && parts[1] === 'tasks') return json(res, 200, rejectExecTask(parts[2], body.reason || '主脑拒绝执行'));
    }

    if (req.method === 'GET' && pathname === '/api/connect-defaults') {
      return json(res, 200, { wsUrl: `ws://127.0.0.1:${PORT}/ws`, token: null, agentName: 'Hermes + OpenClaw Fusion', authEnabled: false, serverSideAuth: true });
    }
    if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { status: 'ok', system: 'Hermes', mode: 'host-hermes-embedded-openclaw-exec' });
    if (req.method === 'GET' && pathname === '/api/gateway/models') return json(res, 200, { models: buildModels(), error: null, source: 'config' });
    if (req.method === 'GET' && pathname === '/api/version') return json(res, 200, { version: '0.0.1', name: 'Hermes + OpenClaw Fusion' });
    if (req.method === 'GET' && pathname === '/api/version/check') return json(res, 200, { ok: true, updateAvailable: false });
    if (req.method === 'GET' && pathname === '/api/server-info') return json(res, 200, buildServerInfo());
    if (req.method === 'GET' && pathname === '/api/language') return json(res, 200, { ok: true, language: 'zh-CN' });
    if (req.method === 'GET' && pathname === '/api/language/support') return json(res, 200, { ok: true, languages: ['zh-CN'] });
    if (req.method === 'GET' && pathname === '/api/auth/status') return json(res, 200, { authenticated: true, authEnabled: false });
    if (req.method === 'POST' && pathname === '/api/auth/login') return json(res, 200, { ok: true });
    if (req.method === 'POST' && pathname === '/api/auth/logout') return json(res, 200, { ok: true });
    if (req.method === 'GET' && pathname === '/api/channels') return json(res, 200, { ok: true, channels: [] });
    if (req.method === 'GET' && pathname === '/api/keys') return json(res, 200, { ok: true, keys: [] });
    if (req.method === 'GET' && pathname === '/api/tokens') return json(res, 200, { entries: [], totalCost: 0, totalInput: 0, totalOutput: 0, totalMessages: 0, updatedAt: Date.now() });
    if (req.method === 'GET' && pathname === '/api/agentlog') return json(res, 200, []);
    if (req.method === 'GET' && pathname === '/api/upload-config') return json(res, 200, { ok: true, uploadsEnabled: false });
    if (req.method === 'POST' && pathname === '/api/upload-reference/resolve') return json(res, 200, { ok: true, items: [] });
    if (req.method === 'GET' && pathname === '/api/transcribe/config') return json(res, 200, { ok: true, enabled: false, providers: [] });
    if (req.method === 'GET' && pathname === '/api/tts/config') return json(res, 200, { ok: true, enabled: false, providers: [] });
    if (req.method === 'GET' && pathname === '/api/voice-phrases/status') return json(res, 200, { ok: true, enabled: false, phrases: [] });
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('data: {"type":"connected"}\n\n');
      const keepAlive = setInterval(() => res.write(':keepalive\n\n'), 30000);
      req.on('close', () => clearInterval(keepAlive));
      return;
    }

    if (req.method === 'GET' && pathname === '/office-status') {
      return serveStatic(res, path.resolve('ui-cockpit/office-status.html'));
    }

    if (req.method === 'GET' && pathname === '/api/files/tree') {
      const dirPath = url.searchParams.get('path') || '';
      const showHidden = url.searchParams.get('showHidden') === 'true';
      const depth = parseInt(url.searchParams.get('depth') || '1', 10);
      const targetDir = dirPath ? path.resolve(PROJECT_DIR, '.' + dirPath) : PROJECT_DIR;
      if (!withinProject(targetDir)) return json(res, 403, { ok: false, error: 'Access denied' });
      return json(res, 200, { ok: true, entries: scanDir(targetDir, showHidden, depth) || [], path: dirPath || '/', workspaceInfo: { isCustomWorkspace: false, rootPath: '/' } });
    }
    if (req.method === 'GET' && pathname === '/api/files/read') {
      const filePath = url.searchParams.get('path') || '';
      const target = path.resolve(PROJECT_DIR, '.' + filePath);
      if (!withinProject(target) || !fs.existsSync(target)) return json(res, 404, { ok: false, error: 'File not found' });
      const stat = fs.statSync(target);
      return json(res, 200, { ok: true, content: fs.readFileSync(target, 'utf-8'), mtime: stat.mtimeMs });
    }
    if (req.method === 'GET' && pathname === '/api/files/raw') {
      const filePath = url.searchParams.get('path') || '';
      const target = path.resolve(PROJECT_DIR, '.' + filePath);
      if (!withinProject(target) || !fs.existsSync(target)) return json(res, 404, { ok: false, error: 'File not found' });
      return serveStatic(res, target);
    }
    if (req.method === 'PUT' && pathname === '/api/files/write') {
      const body = await parseBody(req);
      const target = path.resolve(PROJECT_DIR, '.' + (body.path || ''));
      if (!withinProject(target)) return json(res, 403, { ok: false, error: 'Access denied' });
      const currentMtime = fs.existsSync(target) ? fs.statSync(target).mtimeMs : 0;
      if (body.expectedMtime && currentMtime && body.expectedMtime !== currentMtime) {
        return json(res, 409, { ok: false, conflict: true, mtime: currentMtime });
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body.content || '', 'utf-8');
      return json(res, 200, { ok: true, mtime: fs.statSync(target).mtimeMs });
    }

    if (req.method === 'GET' && pathname.startsWith('/api/workspace/')) {
      const key = pathname.split('/').pop();
      const content = readWorkspaceFile(key);
      if (content == null) return json(res, 404, { ok: false, error: 'Not found' });
      return json(res, 200, { ok: true, content });
    }
    if (req.method === 'PUT' && pathname.startsWith('/api/workspace/')) {
      const key = pathname.split('/').pop();
      const body = await parseBody(req);
      writeWorkspaceFile(key, body.content || '');
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/memories') {
      const hermesOverview = hermesOpenclawFusion.getOverview?.().hermesHost || {};
      const files = Array.isArray(hermesOverview.memory?.files) ? hermesOverview.memory.files : [];
      return json(res, 200, {
        ok: true,
        files,
        total: files.length,
        items: getMemories(),
      });
    }
    if (req.method === 'PATCH' && pathname === '/api/memories/rename') {
      const body = await parseBody(req);
      const oldName = String(body.oldName || '').trim();
      const newNameRaw = String(body.newName || '').trim();
      const newName = newNameRaw.toLowerCase().endsWith('.md') ? newNameRaw : `${newNameRaw}.md`;
      if (!oldName || !newNameRaw) return json(res, 400, { ok: false, error: '缺少文件名' });
      if (/[\\/:*?"<>|]/.test(newName)) return json(res, 400, { ok: false, error: '文件名含非法字符' });
      const hermesOverview = hermesOpenclawFusion.getOverview?.().hermesHost || {};
      const memoryDir = path.dirname((hermesOverview.memory?.files || [])[0]?.path || path.resolve('data/hermes-home/memories'));
      const oldPath = path.join(memoryDir, oldName);
      const newPath = path.join(memoryDir, newName);
      if (!fs.existsSync(oldPath)) return json(res, 404, { ok: false, error: '原文件不存在' });
      if (oldPath !== newPath && fs.existsSync(newPath)) return json(res, 409, { ok: false, error: '目标文件已存在' });
      fs.renameSync(oldPath, newPath);
      return json(res, 200, { ok: true, oldName, newName });
    }
    if (req.method === 'POST' && pathname === '/api/memories') {
      const body = await parseBody(req);
      addMemory(body.text || '', body.section || '', body.category || 'other');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && pathname === '/api/memories') {
      const body = await parseBody(req);
      deleteMemory(body.query || body.text || '');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/memories/section') return json(res, 200, { ok: true, sections: getMemories().filter((m) => m.type === 'section') });

    if (req.method === 'GET' && pathname === '/api/memories/content') {
      const name = url.searchParams.get('name') || '';
      if (!name) return json(res, 400, { ok: false, error: '缺少文件名' });
      const memoryDir = path.resolve('data/hermes-home/memories');
      const relPath = path.normalize(name).replace(/^[./\\\\]+/, '');
      const target = path.resolve(memoryDir, relPath);
      if (!withinProject(path.resolve(target))) return json(res, 403, { ok: false, error: '拒绝访问' });
      if (!fs.existsSync(target)) return json(res, 404, { ok: false, error: '文件不存在' });
      return json(res, 200, { ok: true, content: fs.readFileSync(target, 'utf-8'), name });
    }
    if (req.method === 'PUT' && pathname === '/api/memories/content') {
      const body = await parseBody(req);
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { ok: false, error: '缺少文件名' });
      const memoryDir = path.resolve('data/hermes-home/memories');
      const relPath = path.normalize(name).replace(/^[./\\\\]+/, '');
      const target = path.resolve(memoryDir, relPath);
      if (!withinProject(path.resolve(target))) return json(res, 403, { ok: false, error: '拒绝访问' });
      fs.writeFileSync(target, body.content || '', 'utf-8');
      return json(res, 200, { ok: true, name });
    }

    if (req.method === 'GET' && pathname === '/api/skills') return json(res, 200, { ok: true, skills: buildSkills() });

    if (req.method === 'GET' && pathname === '/api/crons') return json(res, 200, { ok: true, result: { jobs: listCrons() } });
    if (req.method === 'POST' && pathname === '/api/crons') {
      const body = await parseBody(req);
      saveCron(body.job || body);
      return json(res, 200, { ok: true });
    }
    if (pathname.startsWith('/api/crons/')) {
      const parts = pathname.split('/').filter(Boolean);
      const id = decodeURIComponent(parts[2] || '');
      if (req.method === 'PATCH' && parts.length === 3) {
        const body = await parseBody(req);
        saveCron({ id, ...body.patch });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'DELETE' && parts.length === 3) {
        deleteCron(id);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && parts[3] === 'toggle') {
        const body = await parseBody(req);
        toggleCron(id, !!body.enabled);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && parts[3] === 'run') {
        runCron(id);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && parts[3] === 'runs') return json(res, 200, { ok: true, result: { entries: listCronRuns(id) } });
    }

    if (req.method === 'GET' && pathname === '/api/kanban/config') return json(res, 200, buildKanbanConfig());
    if (req.method === 'GET' && pathname === '/api/kanban/tasks') {
      const items = listKanbanTasks();
      return json(res, 200, { items, total: items.length, limit: 200, offset: 0, hasMore: false });
    }
    if (req.method === 'POST' && pathname === '/api/kanban/tasks') {
      const body = await parseBody(req);
      const tasks = saveKanbanTask(body);
      return json(res, 200, tasks[0]);
    }
    if (req.method === 'GET' && pathname === '/api/kanban/proposals') return json(res, 200, { items: [] });
    if (pathname.startsWith('/api/kanban/tasks/')) {
      const parts = pathname.split('/').filter(Boolean);
      const id = decodeURIComponent(parts[3] || '');
      const current = listKanbanTasks().find((t) => t.id === id);
      if (!current) return json(res, 404, { error: 'Task not found' });
      if (req.method === 'PATCH' && parts.length === 4) {
        const body = await parseBody(req);
        const tasks = saveKanbanTask({ ...current, ...body, id, version: current.version });
        return json(res, 200, tasks.find((t) => t.id === id));
      }
      if (req.method === 'DELETE' && parts.length === 4) {
        deleteKanbanTask(id);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && parts[4] === 'reorder') {
        const body = await parseBody(req);
        const tasks = saveKanbanTask({ ...current, status: body.targetStatus || current.status, columnOrder: body.targetIndex ?? current.columnOrder, id, version: current.version });
        return json(res, 200, tasks.find((t) => t.id === id));
      }
      if (req.method === 'POST' && parts[4] === 'execute') {
        const taskRes = hermesOpenclawFusion.submitGoal('kanban-session', current.title);
        const tasks = saveKanbanTask({ ...current, id, version: current.version, status: 'in-progress', run: { sessionKey: taskRes.sessionId || 'kanban-session', runId: taskRes.taskId || id, startedAt: Date.now(), status: 'running' } });
        return json(res, 200, tasks.find((t) => t.id === id));
      }
      if (req.method === 'POST' && parts[4] === 'approve') {
        const tasks = saveKanbanTask({ ...current, id, version: current.version, status: 'done', result: '已批准', resultAt: Date.now() });
        return json(res, 200, tasks.find((t) => t.id === id));
      }
    }

    if (req.method === 'GET' && pathname === '/') {
      return serveStatic(res, COCKPIT_HOME);
    }

    const filePath = path.join(NERVE_DIST, pathname === '/' ? 'index.html' : pathname);
    if (filePath.startsWith(NERVE_DIST) && fs.existsSync(filePath)) return serveStatic(res, filePath);
    if (!pathname.startsWith('/api/')) {
      if (fs.existsSync(COCKPIT_HOME)) return serveStatic(res, COCKPIT_HOME);
    }
    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message || 'Internal error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Hermes + OpenClaw fusion panel (Nerve UI) running at http://127.0.0.1:${PORT}`);
  setupWsBridge(server);
});
