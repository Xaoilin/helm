import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateAgentPolicy } from './lib/agentPolicy.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const result = evaluateAgentPolicy(rootDir)

for (const pass of result.passes) {
  console.log(`PASS ${pass}`)
}

for (const failure of result.failures) {
  console.error(`FAIL ${failure}`)
}

if (!result.ok) {
  process.exitCode = 1
}
