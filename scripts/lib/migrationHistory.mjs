import { readdirSync } from 'node:fs'

// HELM and AgentBoard intentionally share one Supabase project. These are the
// immutable production-ledger entries created by the reviewed AgentBoard
// migrations. The source metadata was verified byte-for-byte against the
// production migration statements before adding the local no-op ledger stubs.
export const externalMigrationLedger = Object.freeze([
  {
    version: '20260803154039',
    name: 'hosted_agentboard_private_schema',
    sourcePath: 'whiteboarding/supabase/migrations/20260803000000_hosted_agentboard.sql',
    statementBytes: 29310,
    statementSha256: '9810ee5cdfd202c6181c5eb25ff878400d80b5a3cd53f34aee58256ef71baa33',
  },
  {
    version: '20260803182735',
    name: 'non_retrying_revision_conflicts',
    sourcePath: 'whiteboarding/supabase/migrations/20260803000001_non_retrying_revision_conflicts.sql',
    statementBytes: 7591,
    statementSha256: 'ed205b405fbc966d4bc0ab824ae17962af6fb03871328c41c04487b7378820bc',
  },
  {
    version: '20260803233550',
    name: 'publisher_capability_rotation',
    sourcePath: 'whiteboarding/supabase/migrations/20260803000002_publisher_capability_rotation.sql',
    statementBytes: 9802,
    statementSha256: '95900ec5074d6313d26a9d92b9291f9636e4d1569cfb2a963c98aa715294aaac',
  },
  {
    version: '20260804050218',
    name: 'agentboard_owner_library',
    sourcePath: 'whiteboarding/supabase/migrations/20260804034133_agentboard_owner_library.sql',
    statementBytes: 15255,
    statementSha256: '319972ab56967dfb1220d7af85c2264c1b550d5249af136d65ba3bb646cfa6f4',
  },
].map(Object.freeze))

export const allowedExternalMigrations = Object.freeze(externalMigrationLedger.map(migration => (
  Object.freeze({ version: migration.version, name: migration.name })
)))

export function readRepositoryMigrations(directory) {
  return readdirSync(directory)
    .map(fileName => {
      const match = fileName.match(/^(\d+)_(.+)\.sql$/u)
      return match ? { version: match[1], name: match[2] } : null
    })
    .filter(Boolean)
    .sort(compareMigrations)
}

export function classifyMigrationHistory({
  repositoryMigrations,
  actualMigrations,
  externalMigrations = allowedExternalMigrations,
}) {
  const repository = normalizeMigrations(repositoryMigrations, 'repository')
  const actual = normalizeMigrations(actualMigrations, 'database')
  const external = normalizeMigrations(externalMigrations, 'external allowlist')
  const repositoryByVersion = indexByVersion(repository, 'repository')
  const actualByVersion = indexByVersion(actual, 'database')
  const externalByVersion = indexByVersion(external, 'external allowlist')

  for (const [version, repositoryMigration] of repositoryByVersion) {
    const externalMigration = externalByVersion.get(version)
    if (externalMigration && externalMigration.name !== repositoryMigration.name) {
      throw new Error(
        `External migration ledger stub ${version}_${repositoryMigration.name} `
        + `does not match ${externalMigration.name}.`,
      )
    }
  }

  const ownedMigrations = []
  const acceptedExternalMigrations = []
  const unexpectedMigrations = []

  for (const migration of actual) {
    const repositoryMigration = repositoryByVersion.get(migration.version)
    const externalMigration = externalByVersion.get(migration.version)
    if (repositoryMigration && externalMigration) {
      if (migration.name === externalMigration.name) acceptedExternalMigrations.push(migration)
      else unexpectedMigrations.push({
        ...migration,
        expectedName: externalMigration.name,
        reason: 'external-name-mismatch',
      })
      continue
    }
    if (repositoryMigration) {
      if (migration.name === repositoryMigration.name) ownedMigrations.push(migration)
      else unexpectedMigrations.push({
        ...migration,
        expectedName: repositoryMigration.name,
        reason: 'helm-name-mismatch',
      })
      continue
    }

    if (externalMigration) {
      if (migration.name === externalMigration.name) acceptedExternalMigrations.push(migration)
      else unexpectedMigrations.push({
        ...migration,
        expectedName: externalMigration.name,
        reason: 'external-name-mismatch',
      })
      continue
    }

    unexpectedMigrations.push({ ...migration, reason: 'unknown-version' })
  }

  const missingOwnedMigrations = repository.filter(expected => {
    if (externalByVersion.has(expected.version)) return false
    const observed = actualByVersion.get(expected.version)
    return !observed || observed.name !== expected.name
  })
  const missingExternalMigrations = external.filter(expected => {
    if (!repositoryByVersion.has(expected.version)) return false
    const observed = actualByVersion.get(expected.version)
    return !observed || observed.name !== expected.name
  })

  return {
    repositoryMigrations: repository,
    ownedMigrations: ownedMigrations.sort(compareMigrations),
    acceptedExternalMigrations: acceptedExternalMigrations.sort(compareMigrations),
    unexpectedMigrations: unexpectedMigrations.sort(compareMigrations),
    missingOwnedMigrations: missingOwnedMigrations.sort(compareMigrations),
    missingExternalMigrations: missingExternalMigrations.sort(compareMigrations),
  }
}

export function formatMigrationEntries(migrations) {
  return migrations
    .map(migration => {
      const expected = migration.expectedName ? ` (expected ${migration.expectedName})` : ''
      return `${migration.version}_${migration.name}${expected}`
    })
    .join(', ')
}

function normalizeMigrations(migrations, label) {
  if (!Array.isArray(migrations)) throw new Error(`${label} migrations must be an array.`)
  return migrations.map(migration => {
    const version = String(migration?.version ?? '').trim()
    const name = String(migration?.name ?? '').trim()
    if (!/^\d+$/u.test(version) || !name) {
      throw new Error(`${label} migration entries require a numeric version and non-empty name.`)
    }
    return { version, name }
  }).sort(compareMigrations)
}

function indexByVersion(migrations, label) {
  const indexed = new Map()
  for (const migration of migrations) {
    if (indexed.has(migration.version)) {
      throw new Error(`${label} migration version ${migration.version} is duplicated.`)
    }
    indexed.set(migration.version, migration)
  }
  return indexed
}

function compareMigrations(left, right) {
  return left.version.localeCompare(right.version) || left.name.localeCompare(right.name)
}
