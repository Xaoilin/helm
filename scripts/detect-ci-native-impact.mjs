import { appendFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectCiNativeImpact } from './lib/ciChangeDetection.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const preferredBase = process.env.CI_BASE_SHA?.trim()

if (!preferredBase) {
  throw new Error('CI_BASE_SHA is required for pull request native-impact detection.')
}

const result = detectCiNativeImpact(rootDir, preferredBase)
const changedFiles = result.files.length > 0 ? result.files.join(', ') : '(none)'

console.log(`CI comparison base: ${result.base}`)
console.log(`CI changed files: ${changedFiles}`)
console.log(`Native matrix required: ${result.native}`)

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `native=${result.native}\n`)
}
