// @vitest-environment node
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  runGroup,
  runTimed,
} from '../../scripts/lib/timedCommands.mjs'

describe('timed command orchestration', () => {
  const missingCommand = join(tmpdir(), 'helm-command-that-does-not-exist')

  it('returns a failed result when a command cannot spawn', async () => {
    await expect(runTimed({
      command: missingCommand,
      label: 'missing command',
    })).resolves.toMatchObject({
      exitCode: 1,
      label: 'missing command',
    })
  })

  it('settles sibling checks before reporting a group failure', async () => {
    try {
      await runGroup([
        {
          command: missingCommand,
          label: 'missing command',
        },
        {
          args: ['-e', 'setTimeout(() => process.exit(0), 50)'],
          command: process.execPath,
          label: 'sibling command',
        },
      ])
      throw new Error('Expected runGroup to fail.')
    } catch (error) {
      expect(error).toMatchObject({
        results: expect.arrayContaining([
          expect.objectContaining({ exitCode: 1, label: 'missing command' }),
          expect.objectContaining({ exitCode: 0, label: 'sibling command' }),
        ]),
      })
    }
  })
})
