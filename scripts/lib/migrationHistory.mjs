import { readdirSync } from 'node:fs'

// HELM and AgentBoard intentionally share one Supabase project. These are the
// immutable production-ledger entries created by the reviewed AgentBoard
// migrations. They are optional for local HELM databases, but an entry using
// one of these versions is accepted only when its name also matches exactly.
export const allowedExternalMigrations = Object.freeze([
  { version: '20260803154039', name: 'hosted_agentboard_private_schema' },
  { version: '20260803182735', name: 'non_retrying_revision_conflicts' },
  { version: '20260803233550', name: 'publisher_capability_rotation' },
  { version: '20260804050218', name: 'agentboard_owner_library' },
].map(Object.freeze))

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

  for (const version of repositoryByVersion.keys()) {
    if (externalByVersion.has(version)) {
      throw new Error(`Migration version ${version} is owned by both HELM and the external allowlist.`)
    }
  }

  const ownedMigrations = []
  const acceptedExternalMigrations = []
  const unexpectedMigrations = []

  for (const migration of actual) {
    const repositoryMigration = repositoryByVersion.get(migration.version)
    if (repositoryMigration) {
      if (migration.name === repositoryMigration.name) ownedMigrations.push(migration)
      else unexpectedMigrations.push({
        ...migration,
        expectedName: repositoryMigration.name,
        reason: 'helm-name-mismatch',
      })
      continue
    }

    const externalMigration = externalByVersion.get(migration.version)
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
    const observed = actualByVersion.get(expected.version)
    return !observed || observed.name !== expected.name
  })

  return {
    repositoryMigrations: repository,
    ownedMigrations: ownedMigrations.sort(compareMigrations),
    acceptedExternalMigrations: acceptedExternalMigrations.sort(compareMigrations),
    unexpectedMigrations: unexpectedMigrations.sort(compareMigrations),
    missingOwnedMigrations: missingOwnedMigrations.sort(compareMigrations),
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
