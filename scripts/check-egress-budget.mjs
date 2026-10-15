import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { checkEgressBudget } from './lib/egressBudget.mjs'

// Offline, read-only provider input. No network, credentials, browser or database access.
try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' },
    config: { type: 'string', default: 'docs/egress-budget.config.json' },
    output: { type: 'string' },
  } })
  if (!values.input || !values.output) throw new Error('arguments')
  const input = await readFile(values.input)
  if (input.length > 64 * 1024) throw new Error('size')
  const report = checkEgressBudget(JSON.parse(input), JSON.parse(await readFile(values.config, 'utf8')))
  // Hash the original bytes, but never echo an invalid input or exception containing private text.
  const receipt = { ...report, inputSha256: createHash('sha256').update(input).digest('hex') }
  await writeFile(values.output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify(receipt))
  process.exitCode = receipt.exitCode
} catch {
  console.error('Egress check failed: require valid bounded JSON and a new output path. See docs/egress-budget.md.')
  process.exitCode = 1
}
