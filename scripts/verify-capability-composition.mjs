import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateCapabilityCompositionSources,
  readCapabilityCompositionSources,
} from './lib/capabilityCompositionPolicy.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = evaluateCapabilityCompositionSources(readCapabilityCompositionSources(rootDir));

if (result.ok) {
  console.log('PASS Capability composition uses domain hooks and workflow-shaped coordinators.');
} else {
  for (const failure of result.failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
}
