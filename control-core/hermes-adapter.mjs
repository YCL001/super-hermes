import fs from 'node:fs';
import path from 'node:path';
import { loadLocalConfig } from '../shared/local-paths.mjs';
import { readHermesConfigState } from '../shared/config-state.mjs';

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function parseSimpleYamlConfig(text) {
  // 统一换行符，避免 CRLF 导致正则失败
  const norm = text.replace(/\r\n?/g, '\n');
  const modelDefault = norm.match(/^model:\n(?:[ \t].*\n)*?[ \t]+default:\s*(.+)$/m)?.[1]?.trim() || '';
  const modelProvider = norm.match(/^model:\n(?:[ \t].*\n)*?[ \t]+provider:\s*(.+)$/m)?.[1]?.trim() || '';
  const terminalBackend = norm.match(/^terminal:\n(?:[ \t].*\n)*?[ \t]+backend:\s*(.+)$/m)?.[1]?.trim() || '';
  const reasoning = norm.match(/^agent:\n(?:[ \t].*\n)*?[ \t]+reasoning_effort:\s*(.+)$/m)?.[1]?.trim() || '';
  return { modelDefault, modelProvider, terminalBackend, reasoning };
}

function walkSkillFiles(rootDir, bucket = []) {
  if (!fs.existsSync(rootDir)) return bucket;
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const skillFile = path.join(full, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        bucket.push(skillFile);
      } else {
        walkSkillFiles(full, bucket);
      }
    }
  }
  return bucket;
}

function parseSkillMeta(skillPath) {
  const content = safeRead(skillPath);
  const name = content.match(/^name:\s*(.+)$/m)?.[1]?.replace(/^['"]|['"]$/g, '').trim() || path.basename(path.dirname(skillPath));
  const description = content.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^['"]|['"]$/g, '').trim() || '';
  return { name, description, path: skillPath };
}

function memoryStats(memoriesDir) {
  if (!fs.existsSync(memoriesDir)) {
    return { exists: false, files: [] };
  }
  const files = fs.readdirSync(memoriesDir)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .map((name) => {
      const full = path.join(memoriesDir, name);
      const stat = fs.statSync(full);
      const firstLine = safeRead(full)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) || '记忆文档';
      return {
        name,
        path: full,
        bytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
        description: firstLine,
      };
    });
  return { exists: true, files };
}

export function getHermesOverview() {
  const config = loadLocalConfig();
  const hermesState = readHermesConfigState();
  const hermesHome = config.paths.hermes_home;
  const configPath = hermesState.hermesConfigPath;
  const skillsDir = config.paths.skills_dir;
  const memoriesDir = config.paths.memories_dir;

  return {
    home: hermesHome,
    configPath,
    config: {
      modelDefault: hermesState.modelDefault,
      modelProvider: hermesState.modelProvider,
      terminalBackend: hermesState.terminalBackend,
      reasoning: hermesState.reasoning,
    },
    skillCount: walkSkillFiles(skillsDir).length,
    sampleSkills: walkSkillFiles(skillsDir).slice(0, 30).map(parseSkillMeta),
    memory: memoryStats(memoriesDir),
  };
}
