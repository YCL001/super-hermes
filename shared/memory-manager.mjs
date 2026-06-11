/**
 * 记忆管理模块 — 短指针 + 索引方案
 *
 * 记忆不堆在一个文件里，而是：
 *   INDEX.md  → 目录（只有一句指针和摘要）
 *   详情文件  → 具体内容
 *
 * 用法:
 *   import { mem } from './shared/memory-manager.mjs';
 *   await mem.init();                  // 初始化空记忆
 *   await mem.add('规则', '主脑职责', 'Hermes 只派单不执行', '详细内容...');
 *   await mem.list();                  // 列出所有记忆条目
 *   await mem.get('文件名');           // 读某个详情文件
 */
import fs from 'node:fs';
import path from 'node:path';

const MEMORIES_DIR = path.resolve(process.cwd(), 'data', 'hermes-home', 'memories');
const INDEX_FILE = path.join(MEMORIES_DIR, 'INDEX.md');

/**
 * 确保记忆目录存在
 */
function ensureDir() {
  if (!fs.existsSync(MEMORIES_DIR)) {
    fs.mkdirSync(MEMORIES_DIR, { recursive: true });
  }
}

/**
 * 解析 INDEX.md 为结构化条目
 */
function parseIndex(text) {
  const entries = [];
  const lines = text.split('\n');
  let currentSection = '';
  for (const line of lines) {
    const secMatch = line.match(/^##\s+(.+)/);
    if (secMatch) { currentSection = secMatch[1].trim(); continue; }
    const entryMatch = line.match(/^\|\s*`(.+?)`\s*\|?\s*(.+)/);
    if (entryMatch) {
      entries.push({ section: currentSection, file: entryMatch[1], summary: entryMatch[2].replace(/^\[.*?\]\s*/, '').trim() });
    }
  }
  return entries;
}

export const mem = {

  /** 初始化：创建空的 INDEX.md + 核心规则文件 */
  async init() {
    ensureDir();
    if (!fs.existsSync(INDEX_FILE)) {
      const now = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(INDEX_FILE, [
        `# 记忆索引`,
        ``,
        `> 短指针 + 详情文件。索引只留一句话指针，详情看对应文件。`,
        `> 最后更新: ${now}`,
        ``,
        `## 📌 核心规则`,
        ``,
        `| 文件 | 说明 |`,
        `|------|------|`,
        `| \`RULES.md\` | Hermes 行为规则 |`,
        ``,
        `## 📓 笔记`,
        ``,
        `| 文件 | 说明 |`,
        `|------|------|`,
        ``,
      ].join('\n'), 'utf-8');
    }
    // 核心规则文件
    const rulesFile = path.join(MEMORIES_DIR, 'RULES.md');
    if (!fs.existsSync(rulesFile)) {
      fs.writeFileSync(rulesFile, [
        `§`,
        `⚡ **核心规则: 主脑职责** > Hermes 只负责接收任务、拆解、派给执行手。`,
        `   禁止直接执行任何系统命令、文件操作或 LLM 调用。`,
        `§`,
        `⚡ **执行手职责** > 执行手（executor.mjs）是唯一有权限直接干活（shell / LLM）的模块。`,
        `§`,
        `⚡ **面板定位** > 面板 UI 仅为可视化监控，不开面板不影响执行手工作。`,
        `§`,
      ].join('\n'), 'utf-8');
    }
  },

  /**
   * 添加一条记忆
   * @param {string} category 分类（如 "核心规则" / "笔记"）
   * @param {string} title    条目标题
   * @param {string} summary  一句话摘要（INDEX 里显示）
   * @param {string} detail   详细内容（写在对应文件里）
   */
  async add(category, title, summary, detail = '') {
    ensureDir();
    const fileName = title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '').slice(0, 40) + '.md';
    const filePath = path.join(MEMORIES_DIR, fileName);

    // 写详情文件
    if (detail) {
      fs.writeFileSync(filePath, detail.trim() + '\n', 'utf-8');
    }

    // 更新 INDEX.md
    const indexContent = fs.existsSync(INDEX_FILE) ? fs.readFileSync(INDEX_FILE, 'utf-8') : '';
    const lines = indexContent.split('\n');

    // 找到对应分类的表格区
    let sectionIdx = -1;
    let tableHeaderIdx = -1;
    let insertIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^##\s+/)) sectionIdx = -1;
      if (lines[i].trim() === `## ${category}`) sectionIdx = i;
      if (sectionIdx >= 0 && lines[i].trim() === '| 文件 | 说明 |') tableHeaderIdx = i;
      if (tableHeaderIdx >= 0 && lines[i].trim() === '|------|------|') {
        insertIdx = i + 1;
        break;
      }
    }

    if (insertIdx < 0) {
      // 分类不存在，追加
      lines.push(`\n## ${category}\n`);
      lines.push('| 文件 | 说明 |');
      lines.push('|------|------|');
      lines.push(`| \`${fileName}\` | ${summary} |`);
    } else {
      const entry = `| \`${fileName}\` | ${summary} |`;
      // 检查是否已存在
      const existing = lines.findIndex(l => l.includes(`\`${fileName}\``));
      if (existing >= 0) {
        lines[existing] = entry; // 更新
      } else {
        lines.splice(insertIdx, 0, entry); // 插入
      }
    }

    fs.writeFileSync(INDEX_FILE, lines.join('\n'), 'utf-8');
    return { file: fileName, path: filePath };
  },

  /** 列出所有记忆条目 */
  async list() {
    if (!fs.existsSync(INDEX_FILE)) return [];
    const text = fs.readFileSync(INDEX_FILE, 'utf-8');
    return parseIndex(text);
  },

  /** 读某个详情文件 */
  async get(fileName) {
    const filePath = path.join(MEMORIES_DIR, fileName);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  },
};
