import fs from 'node:fs';
import path from 'node:path';
import { loadLocalConfig } from '../shared/local-paths.mjs';

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function safeJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function packageSummary(projectPath) {
  const pkg = safeJson(path.join(projectPath, 'package.json'));
  if (!pkg) return null;
  return {
    path: projectPath,
    name: pkg.name || '',
    version: pkg.version || '',
    license: pkg.license || '',
    description: pkg.description || '',
  };
}

function detectOpenclawConfig(openclawHome) {
  const openclawJsonPath = path.join(openclawHome, 'openclaw.json');
  const raw = safeRead(openclawJsonPath);
  if (!raw) {
    return { exists: false, path: openclawJsonPath };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {}

  if (!parsed) {
    return { exists: true, path: openclawJsonPath, parseable: false };
  }

  return {
    exists: true,
    path: openclawJsonPath,
    parseable: true,
    gatewayMode: parsed?.gateway?.mode || '',
    authMode: parsed?.gateway?.auth?.mode || '',
    defaultPrimaryModel: parsed?.agents?.defaults?.model?.primary || parsed?.agents?.defaults?.model || '',
    modelCount: Object.keys(parsed?.agents?.defaults?.models || {}).length,
    providerCount: Object.keys(parsed?.models?.providers || {}).length,
  };
}

function reusedSourceSummary(reusedOpenclawDir) {
  const pathsFile = path.join(reusedOpenclawDir, 'openclaw-paths.ts');
  const skillsFile = path.join(reusedOpenclawDir, 'openclaw-skills.ts');
  const pathsContent = safeRead(pathsFile);
  const skillsContent = safeRead(skillsFile);
  return {
    root: reusedOpenclawDir,
    files: { pathsFile, skillsFile },
    reusesHermesHomeCompat: pathsContent.includes('HERMES_HOME'),
    reusesSkillScanner: skillsContent.includes('walkSkillDirs') && skillsContent.includes('SKILL.md'),
  };
}

export function getOpenclawExecOverview() {
  const config = loadLocalConfig();
  return {
    config: detectOpenclawConfig(config.paths.openclaw_home),
    reviewProject: packageSummary(config.paths.openclaw_review),
    reusedSource: reusedSourceSummary(config.paths.openclaw_review),
  };
}
