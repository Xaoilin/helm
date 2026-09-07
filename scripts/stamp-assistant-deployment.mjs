import { execFileSync } from 'node:child_process'
import { writeFileSync, appendFileSync } from 'node:fs'

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40}$/u.test(sha)) throw new Error('A verified Git commit is required.')
writeFileSync('supabase/functions/_shared/assistantDeployment.ts', `export const ASSISTANT_DEPLOY_SHA: string = ${JSON.stringify(sha)};\n`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `deploy_sha=${sha}\n`)
console.log(`Assistant build identity: ${sha}`)
