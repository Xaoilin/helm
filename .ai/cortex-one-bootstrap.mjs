#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MODULE_NAME = 'sabah-memory';
const MODULE_PATH = '.ai/sabah-memory';
const EXPECTED_IDENTITY = 'github.com/xaoilin/sabah-ai-memory';
const NETWORK_TIMEOUT_DEFAULT_MS = 60_000;
const CRITICAL_SCRIPTS = [
  'scripts/memory-cli.mjs',
  'scripts/lib/git-operations.mjs',
  'scripts/lib/memory-workspaces.mjs',
  'scripts/lib/project-install.mjs',
  'scripts/lib/prompt-hooks.mjs',
  'scripts/lib/runtime.mjs',
  'scripts/lib/skills.mjs',
  'scripts/lib/validation.mjs',
];

function networkTimeoutMs() {
  const raw = process.env.SABAH_MEMORY_NETWORK_TIMEOUT_MS;
  if (raw === undefined) return NETWORK_TIMEOUT_DEFAULT_MS;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error('SABAH_MEMORY_NETWORK_TIMEOUT_MS must be a positive integer in milliseconds');
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > 2_147_483_647) {
    throw new Error('SABAH_MEMORY_NETWORK_TIMEOUT_MS is outside the supported integer range');
  }
  return parsed;
}

function run(command, args, {
  cwd,
  allowFailure = false,
  network = false,
  operation = command,
} = {}) {
  const timeout = network ? networkTimeoutMs() : undefined;
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      GIT_NO_REPLACE_OBJECTS: '1',
      ...(network ? {
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never',
        SSH_ASKPASS_REQUIRE: 'never',
      } : {}),
    },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
  if (result.error?.code === 'ETIMEDOUT') throw new Error(`${operation} timed out after ${timeout} ms`);
  if (result.error) throw new Error(`could not run ${command}: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${command} exited with status ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function git(root, args, options = {}) {
  return run('git', ['-C', root, ...args], options);
}

async function isIndependentGitCheckout(checkout) {
  const result = git(checkout, ['rev-parse', '--show-toplevel'], { allowFailure: true });
  if (result.status !== 0 || !result.stdout.trim()) return false;
  return await realpath(path.resolve(result.stdout.trim())) === await realpath(path.resolve(checkout));
}

function strictRemoteIdentity(rawValue) {
  const raw = String(rawValue ?? '').trim();
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error('memory repository URL is empty or unsafe');
  let repository = '';
  const scp = raw.match(/^git@github\.com:([^?#]+)$/i);
  if (scp) {
    repository = scp[1];
  } else {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('memory repository URL must use GitHub SSH or HTTPS');
    }
    if (parsed.protocol === 'https:') {
      if (parsed.hostname.toLowerCase() !== 'github.com' || parsed.port || parsed.username || parsed.password) {
        throw new Error('memory HTTPS URL must be credential-free github.com');
      }
    } else if (parsed.protocol === 'ssh:') {
      if (parsed.hostname.toLowerCase() !== 'github.com' || parsed.port || parsed.username !== 'git' || parsed.password) {
        throw new Error('memory SSH URL must use git@github.com');
      }
    } else {
      throw new Error('memory repository URL must use GitHub SSH or HTTPS');
    }
    if (parsed.search || parsed.hash) throw new Error('memory repository URL must not contain a query or fragment');
    try {
      repository = decodeURIComponent(parsed.pathname);
    } catch {
      throw new Error('memory repository URL contains invalid escaping');
    }
  }
  const normalized = repository.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').toLowerCase();
  if (normalized !== 'xaoilin/sabah-ai-memory') {
    throw new Error(`memory repository identity mismatch (expected ${EXPECTED_IDENTITY})`);
  }
  return EXPECTED_IDENTITY;
}

function configValues(root, args) {
  const result = git(root, args, { allowFailure: true });
  if (result.status === 1) return [];
  if (result.status !== 0) throw new Error(`could not inspect Git configuration: ${args.join(' ')}`);
  return result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

function oneConfigValue(root, args, label) {
  const values = configValues(root, args);
  if (values.length !== 1) throw new Error(`${label} must have exactly one value; found ${values.length}`);
  return values[0];
}

function verifyEffectiveUrl(projectRoot, raw, label) {
  strictRemoteIdentity(raw);
  const result = git(projectRoot, ['ls-remote', '--get-url', '--', raw], { allowFailure: true });
  const values = result.status === 0
    ? result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
    : [];
  if (values.length !== 1) throw new Error(`${label} must resolve to exactly one effective URL`);
  strictRemoteIdentity(values[0]);
  return values[0];
}

function verifyOrigin(checkout, projectRoot) {
  const rawFetch = configValues(checkout, ['config', '--get-all', 'remote.origin.url']);
  const configuredPush = configValues(checkout, ['config', '--get-all', 'remote.origin.pushurl']);
  const rawPush = configuredPush.length ? configuredPush : rawFetch;
  if (rawFetch.length !== 1 || rawPush.length !== 1) {
    throw new Error('initialized memory origin must have exactly one fetch URL and one push URL');
  }
  const resolvedRawFetch = verifyEffectiveUrl(projectRoot, rawFetch[0], 'initialized memory fetch URL');
  const resolvedRawPush = verifyEffectiveUrl(projectRoot, rawPush[0], 'initialized memory push URL');
  const effectiveFetch = oneConfigValue(checkout, ['remote', 'get-url', '--all', 'origin'], 'effective memory fetch URL');
  const effectivePush = oneConfigValue(checkout, ['remote', 'get-url', '--push', '--all', 'origin'], 'effective memory push URL');
  strictRemoteIdentity(effectiveFetch);
  strictRemoteIdentity(effectivePush);
  if (resolvedRawFetch !== rawFetch[0]
    || resolvedRawPush !== rawPush[0]
    || effectiveFetch !== rawFetch[0]
    || effectivePush !== rawPush[0]) {
    throw new Error('URL rewriting of the pinned memory origin is forbidden');
  }
}

async function assertSafePath(target, label, expectedType) {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (info.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${target}`);
  if (expectedType === 'file' && !info.isFile()) throw new Error(`${label} must be a regular file: ${target}`);
  if (expectedType === 'directory' && !info.isDirectory()) throw new Error(`${label} must be a directory: ${target}`);
  return true;
}

async function verifyCriticalCheckout(checkout) {
  const untracked = git(checkout, [
    'ls-files', '--others', '--exclude-standard', '-z', '--', 'scripts',
  ]).stdout.split('\0').filter(Boolean);
  if (untracked.length) throw new Error(`memory scripts contain untracked files: ${untracked.join(', ')}`);
  for (const relative of CRITICAL_SCRIPTS) {
    const absolute = path.join(checkout, ...relative.split('/'));
    if (!await assertSafePath(absolute, relative, 'file')) throw new Error(`required memory script is missing: ${relative}`);
    const index = git(checkout, ['ls-files', '--stage', '--', relative]).stdout.trim().split(/\r?\n/).filter(Boolean);
    if (index.length !== 1) throw new Error(`memory script must have exactly one index entry: ${relative}`);
    const match = index[0].match(/^(100644|100755) ([a-f0-9]{40,64}) 0\t(.+)$/);
    if (!match || match[3] !== relative) throw new Error(`memory script has an unsafe Git index entry: ${relative}`);
    const flags = git(checkout, ['ls-files', '-v', '--', relative]).stdout.trim();
    if (flags !== `H ${relative}`) throw new Error(`memory script uses unsafe Git index flags: ${relative}`);
    const headBlob = git(checkout, ['rev-parse', `HEAD:${relative}`], { allowFailure: true });
    const workingBlob = git(checkout, ['hash-object', '--no-filters', '--', relative], { allowFailure: true });
    if (headBlob.status !== 0
      || workingBlob.status !== 0
      || headBlob.stdout.trim() !== match[2]
      || workingBlob.stdout.trim() !== match[2]) {
      throw new Error(`memory script does not exactly match committed HEAD and the Git index: ${relative}`);
    }
  }
}

async function main() {
  const projectResult = git(process.cwd(), ['rev-parse', '--show-toplevel'], { allowFailure: true });
  if (projectResult.status !== 0 || !projectResult.stdout.trim()) throw new Error('run the memory bootstrap inside a Git project');
  const projectRoot = path.resolve(projectResult.stdout.trim());
  const gitmodules = path.join(projectRoot, '.gitmodules');
  if (!await assertSafePath(gitmodules, '.gitmodules', 'file')) throw new Error('.gitmodules is missing');

  const moduleKey = `submodule.${MODULE_NAME}`;
  const value = (field) => oneConfigValue(
    projectRoot,
    ['config', '-f', '.gitmodules', '--get-all', `${moduleKey}.${field}`],
    `.gitmodules ${field}`,
  );
  if (value('path') !== MODULE_PATH) throw new Error(`memory submodule path must be ${MODULE_PATH}`);
  if (value('branch') !== 'main') throw new Error('memory submodule branch must be main');
  if (value('ignore') !== 'all') throw new Error('memory submodule ignore policy must be all');
  const declaredUrl = value('url');
  if (verifyEffectiveUrl(projectRoot, declaredUrl, '.gitmodules memory URL') !== declaredUrl) {
    throw new Error('URL rewriting of the pinned .gitmodules URL is forbidden');
  }
  const pathMappings = configValues(projectRoot, ['config', '-f', '.gitmodules', '--get-regexp', '^submodule\..*\.path$']);
  const matchingMappings = pathMappings.filter((line) => line.endsWith(` ${MODULE_PATH}`));
  if (matchingMappings.length !== 1 || !matchingMappings[0].startsWith(`${moduleKey}.path `)) {
    throw new Error(`${MODULE_PATH} must be registered exactly once as ${MODULE_NAME}`);
  }

  const aiDirectory = path.join(projectRoot, '.ai');
  const checkout = path.join(projectRoot, ...MODULE_PATH.split('/'));
  if (!await assertSafePath(aiDirectory, '.ai', 'directory')) await mkdir(aiDirectory, { recursive: false });
  await assertSafePath(checkout, MODULE_PATH, 'directory');
  const localUrl = configValues(projectRoot, ['config', '--get-all', `${moduleKey}.url`]);
  if (localUrl.length > 1) throw new Error('local memory submodule URL must have at most one value');
  if (localUrl.length === 1
    && verifyEffectiveUrl(projectRoot, localUrl[0], 'local memory submodule URL') !== localUrl[0]) {
    throw new Error('URL rewriting of the pinned local submodule URL is forbidden');
  }

  const gitlink = oneConfigValue(projectRoot, ['ls-files', '--stage', '--', MODULE_PATH], 'memory gitlink');
  const gitlinkMatch = gitlink.match(/^160000 ([a-f0-9]{40,64}) 0\t\.ai\/sabah-memory$/);
  if (!gitlinkMatch) throw new Error('memory path is not a stage-zero Git submodule link');
  const wasInitialized = await isIndependentGitCheckout(checkout);
  if (!wasInitialized) {
    const disabledHooks = path.join(tmpdir(), `sabah-memory-disabled-hooks-${randomUUID()}`);
    git(projectRoot, [
      '-c', `core.hooksPath=${disabledHooks}`,
      'submodule', 'update', '--init', '--checkout', '--', MODULE_PATH,
    ], { network: true, operation: 'Git submodule initialization for Sabah AI Memory' });
  }
  if (!await isIndependentGitCheckout(checkout)) {
    throw new Error('memory submodule initialization did not produce a Git checkout');
  }
  verifyOrigin(checkout, projectRoot);
  const checkoutHead = git(checkout, ['rev-parse', '--verify', 'HEAD']).stdout.trim();
  if (!wasInitialized && checkoutHead !== gitlinkMatch[1]) throw new Error('fresh memory checkout does not match the parent gitlink');
  if (git(checkout, ['merge-base', '--is-ancestor', gitlinkMatch[1], checkoutHead], { allowFailure: true }).status !== 0) {
    throw new Error('initialized memory HEAD does not descend from the parent gitlink');
  }
  await verifyCriticalCheckout(checkout);
  const cli = path.join(checkout, 'scripts', 'memory-cli.mjs');
  if (!await assertSafePath(cli, 'memory CLI', 'file')) {
    throw new Error('the pinned memory gitlink predates the cross-platform CLI; refresh this project with install-project once');
  }
  process.stdout.write(`Sabah AI Memory bootstrap verified: ${checkout}\n`);
}

export const bootstrapInternals = Object.freeze({
  isIndependentGitCheckout,
});

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Memory bootstrap failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
