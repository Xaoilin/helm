#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MODES = new Set(['blocking', 'full', 'smoke', 'visual']);
const VISUAL_VIEWPORTS = new Set([
  'desktop-1024',
  'desktop-1366',
  'desktop-1440',
  'phone-320',
  'phone-390',
  'tablet-768',
]);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const playwrightCli = path.join(
  projectRoot,
  'node_modules',
  '@playwright',
  'test',
  'cli.js',
);

const parsed = parseArguments(process.argv.slice(2));
const port = await allocatePort();
const environment = {
  ...process.env,
  HELM_E2E_PORT: String(port),
  HELM_E2E_RUN_ID: `${Date.now()}-${port}`,
};
delete environment.NO_COLOR;

const playwrightArguments = ['test'];
if (parsed.mode === 'smoke') {
  playwrightArguments.push('--grep', '@smoke');
} else if (parsed.mode === 'visual') {
  environment.HELM_E2E_VISUAL_SURFACE = parsed.surface;
  environment.HELM_E2E_VISUAL_VIEWPORTS = parsed.viewports.join(',');
  playwrightArguments.push('--grep', '@visual');
} else {
  playwrightArguments.push('--grep-invert', '@visual');
}
playwrightArguments.push(...parsed.playwrightArguments);

console.log(`[helm-e2e] mode=${parsed.mode} port=${port}`);
if (parsed.mode === 'visual') {
  console.log(
    `[helm-e2e] surface=${parsed.surface || 'all'} viewports=${parsed.viewports.join(',')}`,
  );
}

const child = spawn(process.execPath, [playwrightCli, ...playwrightArguments], {
  cwd: projectRoot,
  env: environment,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
process.exitCode = exitCode;

function parseArguments(arguments_) {
  const values = [...arguments_];
  const modeArgument = values[0] && MODES.has(values[0]) ? values.shift() : 'blocking';
  const requestedMode = modeArgument === 'full' ? 'blocking' : modeArgument;
  let surface = '';
  let viewports = ['390x844', '1440x900'];
  const playwrightArguments = [];
  let visualOptionSupplied = false;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--') continue;

    if (value === '--surface') {
      surface = requireValue(values, ++index, '--surface').trim().toLowerCase();
      visualOptionSupplied = true;
      continue;
    }
    if (value.startsWith('--surface=')) {
      surface = value.slice('--surface='.length).trim().toLowerCase();
      visualOptionSupplied = true;
      continue;
    }
    if (value === '--viewports') {
      viewports = parseViewports(requireValue(values, ++index, '--viewports'));
      visualOptionSupplied = true;
      continue;
    }
    if (value.startsWith('--viewports=')) {
      viewports = parseViewports(value.slice('--viewports='.length));
      visualOptionSupplied = true;
      continue;
    }
    playwrightArguments.push(value);
  }

  if (requestedMode !== 'visual' && visualOptionSupplied) {
    fail('--surface and --viewports are only valid in visual mode.');
  }

  return {
    mode: requestedMode,
    playwrightArguments,
    surface,
    viewports,
  };
}

function parseViewports(value) {
  const viewports = [...new Set(value.split(',').map(entry => entry.trim()).filter(Boolean))];
  if (viewports.length === 0) fail('--viewports requires at least one viewport name.');

  const unknown = viewports.filter(viewport => (
    !VISUAL_VIEWPORTS.has(viewport) && !isViewportDimensions(viewport)
  ));
  if (unknown.length > 0) {
    fail(`Unknown viewport(s): ${unknown.join(', ')}.`);
  }
  return viewports;
}

function isViewportDimensions(value) {
  const match = value.match(/^([1-9]\d{2,3})x([1-9]\d{2,3})$/u);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width >= 240 && width <= 3_840 && height >= 320 && height <= 2_160;
}

function requireValue(values, index, option) {
  const value = values[index];
  if (!value || value.startsWith('--')) fail(`${option} requires a value.`);
  return value;
}

function fail(message) {
  console.error(`[helm-e2e] ${message}`);
  process.exit(2);
}

async function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to allocate an isolated Playwright port.'));
        return;
      }
      const { port: allocatedPort } = address;
      server.close(error => {
        if (error) reject(error);
        else resolve(allocatedPort);
      });
    });
  });
}
