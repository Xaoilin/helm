import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = resolve(rootDir, 'package.json');
const packageLockPath = resolve(rootDir, 'package-lock.json');
const releaseManifestPath = resolve(rootDir, 'public', 'release.json');
const checkOnly = process.argv.includes('--check');

function run(command, args) {
  return execFileSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/u);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function compareSemver(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  if (!leftParts || !rightParts) return null;

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }

  return 0;
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const packageVersion = packageJson.version;

if (typeof packageVersion !== 'string' || packageVersion.trim().length === 0) {
  throw new Error('package.json version is missing or invalid.');
}

const mismatches = [];
const updates = [];
const currentBranch = (() => {
  try {
    return run('git', ['branch', '--show-current']);
  } catch {
    return '';
  }
})();

const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8'));
if (packageLock.version !== packageVersion || packageLock.packages?.['']?.version !== packageVersion) {
  if (checkOnly) {
    mismatches.push(`package-lock.json is ${packageLock.version} but package.json is ${packageVersion}`);
  } else {
    packageLock.version = packageVersion;
    if (packageLock.packages?.['']) {
      packageLock.packages[''].version = packageVersion;
    }
    writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
    updates.push(`Synced package-lock.json to ${packageVersion}`);
  }
}

const releaseManifest = JSON.parse(readFileSync(releaseManifestPath, 'utf8'));
if (releaseManifest.version !== packageVersion) {
  if (checkOnly) {
    mismatches.push(`public/release.json is ${releaseManifest.version} but package.json is ${packageVersion}`);
  } else {
    releaseManifest.version = packageVersion;
    writeFileSync(releaseManifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`);
    updates.push(`Synced public/release.json to ${packageVersion}`);
  }
}

if (checkOnly) {
  if (currentBranch.startsWith('codex/')) {
    try {
      const masterPackageJson = JSON.parse(run('git', ['show', 'origin/master:package.json']));
      const masterVersion = masterPackageJson?.version;
      if (typeof masterVersion === 'string' && masterVersion.length > 0) {
        const versionComparison = compareSemver(packageVersion, masterVersion);
        if (versionComparison === null) {
          mismatches.push(`Could not compare package.json version ${packageVersion} against origin/master version ${masterVersion}`);
        } else if (versionComparison <= 0) {
          mismatches.push(`Feature branch ${currentBranch} must bump the version above origin/master (${masterVersion}); current package.json is still ${packageVersion}`);
        }
      }
    } catch (error) {
      mismatches.push(`Could not verify the feature-branch version bump against origin/master: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (mismatches.length > 0) {
    console.error(`Version drift detected for release ${packageVersion}:`);
    for (const mismatch of mismatches) {
      console.error(`- ${mismatch}`);
    }
    process.exit(1);
  }

  console.log(`Version check passed for ${packageVersion}.`);
  process.exit(0);
}

if (updates.length === 0) {
  console.log(`All release files already match ${packageVersion}.`);
  process.exit(0);
}

for (const update of updates) {
  console.log(update);
}
