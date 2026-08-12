// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  allowedExternalMigrations,
  classifyMigrationHistory,
  externalMigrationLedger,
} from '../../scripts/lib/migrationHistory.mjs'

const helmMigrations = [
  { version: '20260415090000', name: 'google_calendar_credentials' },
  { version: '20260501090000', name: 'kv_store' },
]

describe('shared Supabase migration history', () => {
  it('accepts the exact reviewed AgentBoard ledger entries', () => {
    const result = classifyMigrationHistory({
      repositoryMigrations: helmMigrations,
      actualMigrations: [...helmMigrations, ...allowedExternalMigrations],
    })

    expect(result.ownedMigrations).toEqual(helmMigrations)
    expect(result.acceptedExternalMigrations).toEqual(allowedExternalMigrations)
    expect(result.unexpectedMigrations).toEqual([])
    expect(result.missingOwnedMigrations).toEqual([])
  })

  it('accepts exact local no-op stubs without making external migrations HELM-owned', () => {
    const result = classifyMigrationHistory({
      repositoryMigrations: [...helmMigrations, ...allowedExternalMigrations],
      actualMigrations: [...helmMigrations, ...allowedExternalMigrations],
    })

    expect(result.ownedMigrations).toEqual(helmMigrations)
    expect(result.acceptedExternalMigrations).toEqual(allowedExternalMigrations)
    expect(result.missingOwnedMigrations).toEqual([])
    expect(result.missingExternalMigrations).toEqual([])
  })

  it('keeps every external ledger stub SQL-free and bound to reviewed source evidence', () => {
    for (const migration of externalMigrationLedger) {
      const body = readFileSync(
        new URL(
          `../../supabase/migrations/${migration.version}_${migration.name}.sql`,
          import.meta.url,
        ),
        'utf8',
      )
      expect(body).toContain(`Source: ${migration.sourcePath}`)
      expect(body).toContain(`Statement bytes: ${migration.statementBytes}`)
      expect(body).toContain(`Statement SHA-256: ${migration.statementSha256}`)
      expect(body.replace(/^--.*$/gmu, '').trim()).toBe('')
    }
  })

  it('does not require external migrations in a HELM-only database', () => {
    const result = classifyMigrationHistory({
      repositoryMigrations: [...helmMigrations, ...allowedExternalMigrations],
      actualMigrations: helmMigrations,
    })

    expect(result.acceptedExternalMigrations).toEqual([])
    expect(result.unexpectedMigrations).toEqual([])
    expect(result.missingOwnedMigrations).toEqual([])
    expect(result.missingExternalMigrations).toEqual(allowedExternalMigrations)
  })

  it('rejects a local external ledger stub with a mismatched name', () => {
    expect(() => classifyMigrationHistory({
      repositoryMigrations: [
        ...helmMigrations,
        { version: allowedExternalMigrations[0].version, name: 'wrong_local_stub' },
      ],
      actualMigrations: helmMigrations,
    })).toThrow(/does not match hosted_agentboard_private_schema/u)
  })

  it('rejects an unknown external migration', () => {
    const result = classifyMigrationHistory({
      repositoryMigrations: helmMigrations,
      actualMigrations: [
        ...helmMigrations,
        { version: '20260805000000', name: 'unreviewed_shared_schema' },
      ],
    })

    expect(result.unexpectedMigrations).toEqual([
      { version: '20260805000000', name: 'unreviewed_shared_schema', reason: 'unknown-version' },
    ])
  })

  it('rejects a reviewed external version with a different name', () => {
    const migration = allowedExternalMigrations[0]
    const result = classifyMigrationHistory({
      repositoryMigrations: helmMigrations,
      actualMigrations: [
        ...helmMigrations,
        { version: migration.version, name: 'different_schema' },
      ],
    })

    expect(result.unexpectedMigrations).toEqual([{
      version: migration.version,
      name: 'different_schema',
      expectedName: migration.name,
      reason: 'external-name-mismatch',
    }])
  })

  it('rejects a HELM version with a different name and reports the owned entry missing', () => {
    const result = classifyMigrationHistory({
      repositoryMigrations: helmMigrations,
      actualMigrations: [
        { version: helmMigrations[0].version, name: 'wrong_helm_schema' },
        helmMigrations[1],
      ],
    })

    expect(result.unexpectedMigrations[0]).toMatchObject({
      version: helmMigrations[0].version,
      reason: 'helm-name-mismatch',
    })
    expect(result.missingOwnedMigrations).toEqual([helmMigrations[0]])
  })
})
