import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapInternals } from '../../.ai/cortex-one-bootstrap.mjs'

const canonicalTimeoutVariable = 'CORTEX_ONE_NETWORK_TIMEOUT_MS'
const legacyTimeoutVariable = 'SABAH_MEMORY_NETWORK_TIMEOUT_MS'

afterEach(() => {
  delete process.env[canonicalTimeoutVariable]
  delete process.env[legacyTimeoutVariable]
})

describe('Cortex One bootstrap compatibility diagnostics', () => {
  it('names the legacy timeout variable when it supplies an invalid value', () => {
    process.env[legacyTimeoutVariable] = 'not-a-number'

    expect(() => bootstrapInternals.networkTimeoutMs()).toThrow(
      `${legacyTimeoutVariable} must be a positive integer in milliseconds`,
    )
  })

  it('names the legacy timeout variable when its value is out of range', () => {
    process.env[legacyTimeoutVariable] = '2147483648'

    expect(() => bootstrapInternals.networkTimeoutMs()).toThrow(
      `${legacyTimeoutVariable} is outside the supported integer range`,
    )
  })

  it('describes both accepted repository identities on mismatch', () => {
    expect(() => bootstrapInternals.strictRemoteIdentity('https://github.com/xaoilin/other-repository.git'))
      .toThrow(
        'memory repository identity mismatch (expected github.com/xaoilin/cortex-one or github.com/xaoilin/sabah-ai-memory)',
      )
  })

  it('keeps canonical and legacy repository identities accepted', () => {
    expect(bootstrapInternals.strictRemoteIdentity('https://github.com/xaoilin/cortex-one.git'))
      .toBe('github.com/xaoilin/cortex-one')
    expect(bootstrapInternals.strictRemoteIdentity('git@github.com:Xaoilin/sabah-ai-memory.git'))
      .toBe('github.com/xaoilin/sabah-ai-memory')
  })
})
