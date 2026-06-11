#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const hermesHome = path.join(projectRoot, 'data', 'hermes-home');
const hermesLogDir = path.join(hermesHome, 'logs');

fs.mkdirSync(hermesLogDir, { recursive: true });
process.chdir(projectRoot);
process.env.HERMES_HOME = hermesHome;
process.env.HERMES_LOG_DIR = hermesLogDir;

await import('../ui-cockpit/server.mjs');
