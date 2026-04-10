import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = resolve(rootDir, 'package.json');
const packageLockPath = resolve(rootDir, 'package-lock.json');
const cargoTomlPath = resolve(rootDir, 'src-tauri', 'Cargo.toml');
const tauriConfigPath = resolve(rootDir, 'src-tauri', 'tauri.conf.json');
const checkOnly = process.argv.includes('--check');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const packageVersion = packageJson.version;

if (typeof packageVersion !== 'string' || packageVersion.trim().length === 0) {
  throw new Error('package.json version is missing or invalid.');
}

const mismatches = [];
const updates = [];

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

const cargoToml = readFileSync(cargoTomlPath, 'utf8');
const cargoMatch = cargoToml.match(/(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m);
if (!cargoMatch) {
  throw new Error('Could not find the [package] version in src-tauri/Cargo.toml.');
}
const cargoVersion = cargoMatch[2];
if (cargoVersion !== packageVersion) {
  if (checkOnly) {
    mismatches.push(`src-tauri/Cargo.toml is ${cargoVersion} but package.json is ${packageVersion}`);
  } else {
    const nextCargoToml = cargoToml.replace(cargoMatch[0], `${cargoMatch[1]}${packageVersion}${cargoMatch[3]}`);
    writeFileSync(cargoTomlPath, nextCargoToml);
    updates.push(`Synced src-tauri/Cargo.toml to ${packageVersion}`);
  }
}

const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'));
if (tauriConfig.version !== packageVersion) {
  if (checkOnly) {
    mismatches.push(`src-tauri/tauri.conf.json is ${tauriConfig.version} but package.json is ${packageVersion}`);
  } else {
    tauriConfig.version = packageVersion;
    writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);
    updates.push(`Synced src-tauri/tauri.conf.json to ${packageVersion}`);
  }
}

if (mismatches.length > 0) {
  console.error(`Version drift detected for release ${packageVersion}:`);
  for (const mismatch of mismatches) {
    console.error(`- ${mismatch}`);
  }
  process.exit(1);
}

if (checkOnly) {
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
