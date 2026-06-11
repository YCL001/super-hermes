#!/usr/bin/env node
/**
 * 安装状态检测 — npm run check
 *
 * 检查：Node.js / Hermes / npm 依赖 / 配置文件 / API Key / 面板端口
 * 返回 0=全部正常 1=有警告 2=有错误
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import http from 'node:http';

const CWD = process.cwd();
const results = { pass: [], warn: [], fail: [] };

function ok(msg) { results.pass.push(msg); }
function warn(msg) { results.warn.push(msg); }
function fail(msg) { results.fail.push(msg); }

function check(name, fn) {
  try { fn(); } catch (e) { fail(`${name}: ${e.message}`); }
}

function exists(p) { return fs.existsSync(path.resolve(CWD, p)); }
function cmdExists(cmd) {
  try { execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 5000 }); return true; }
  catch { return false; }
}

console.log('');
console.log('╔══════════════════════════════════════╗');
console.log('║     Super Hermes 状态检测');
console.log('╚══════════════════════════════════════╝');
console.log('');

// 1. Node.js
check('Node.js', () => {
  if (cmdExists('node')) ok(`Node.js ${execSync('node -v', { stdio: 'pipe' }).toString().trim()}`);
  else fail('Node.js 未安装，请安装: https://nodejs.org');
});

// 2. Hermes
check('Hermes', () => {
  if (cmdExists('hermes')) {
    const ver = execSync('hermes --version 2>&1 || true', { stdio: 'pipe' }).toString().trim();
    ok(`Hermes ${ver || '已安装'}`);
  } else {
    fail('Hermes 未安装');
  }
});

// 3. npm 依赖
check('npm 依赖', () => {
  if (exists('node_modules/ws')) ok('ws 依赖已安装');
  else fail('npm 依赖未安装，请运行 npm install');
});

// 4. 配置文件
check('配置文件', () => {
  let allOk = true;
  if (!exists('config/local-dev.json')) { fail('缺少 config/local-dev.json'); allOk = false; }
  if (!exists('data/hermes-home/config.yaml')) { fail('缺少 data/hermes-home/config.yaml'); allOk = false; }
  if (!exists('data/openclaw-home/openclaw.json')) { fail('缺少 data/openclaw-home/openclaw.json'); allOk = false; }
  if (allOk) ok('配置文件齐全');
});

// 5. API Key
check('API Key', () => {
  const envFile = path.resolve(CWD, 'data/hermes-home/.env');
  if (!exists('data/hermes-home/.env')) {
    fail('未找到 data/hermes-home/.env，请配置 API Key');
    return;
  }
  const content = fs.readFileSync(envFile, 'utf-8');
  const keys = content.split('\n').filter(l => l.includes('_API_KEY=') && !l.endsWith('='));
  if (keys.length === 0) {
    fail('.env 中存在空的 API Key');
  } else {
    ok(`已配置 ${keys.length} 个 API Key`);
  }
});

// 6. 记忆索引
check('记忆索引', () => {
  if (exists('data/hermes-home/memories/INDEX.md')) ok('记忆索引已初始化');
  else warn('记忆索引未初始化，运行 npm run cockpit 后会自动创建');
});

// 7. 面板端口
check('面板端口 24318', () => {
  try {
    const req = http.get('http://127.0.0.1:24318/api/overview', { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          ok(`面板运行中 (${j.system || 'Hermes'})`);
        } catch { ok('面板运行中'); }
      });
    });
    req.on('error', () => warn('面板未启动，运行 npm run cockpit'));
    req.end();
  } catch { warn('面板未启动，运行 npm run cockpit'); }
});

// 等待面板检测完成（最多 2s）
setTimeout(() => {
  console.log('  项目根目录:', CWD);
  console.log('');

  if (results.pass.length) {
    console.log(`  ✅ ${results.pass.length} 项正常`);
    results.pass.forEach(r => console.log(`     ${r}`));
    console.log('');
  }
  if (results.warn.length) {
    console.log(`  ⚠️  ${results.warn.length} 项警告`);
    results.warn.forEach(r => console.log(`     ${r}`));
    console.log('');
  }
  if (results.fail.length) {
    console.log(`  ❌ ${results.fail.length} 项错误`);
    results.fail.forEach(r => console.log(`     ${r}`));
    console.log('');
  }

  const exitCode = results.fail.length > 0 ? 2 : results.warn.length > 0 ? 1 : 0;
  if (exitCode === 0) console.log('  一切正常 ✓');
  else if (exitCode === 1) console.log('  有警告，不影响使用');
  else console.log('  有问题需要处理');

  process.exit(exitCode);
}, 2200);
