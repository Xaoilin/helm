// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260731142920_helm_database_authoritative_persistence.sql', import.meta.url),
  'utf8',
);
const secretMigration = readFileSync(
  new URL('../../supabase/migrations/20260731173151_helm_secret_vault.sql', import.meta.url),
  'utf8',
);
const snapshotMigration = readFileSync(
  new URL('../../supabase/migrations/20260801185912_atomic_helm_account_snapshot.sql', import.meta.url),
  'utf8',
);
const persistence = readFileSync(new URL('../store/persistence.ts', import.meta.url), 'utf8');
const appRoot = readFileSync(new URL('../AppRoot.tsx', import.meta.url), 'utf8');

describe('database-authoritative persistence contract', () => {
  it('defines account-owned records, versions, tombstones, and idempotency receipts', () => {
    expect(migration).toContain('create table if not exists public.helm_records');
    expect(migration).toContain('primary key (user_id, collection, record_id)');
    expect(migration).toContain('account_version bigint');
    expect(migration).toContain('deleted_at timestamptz');
    expect(migration).toContain('create table if not exists public.helm_mutation_receipts');
  });

  it('allows authenticated reads but only constrained RPC mutations', () => {
    expect(migration).toContain('using ((select auth.uid()) = user_id)');
    expect(migration).toContain('revoke all on public.helm_records from public, anon, authenticated');
    expect(migration).toContain('grant select on public.helm_records to authenticated');
    expect(migration).toContain('security definer');
    expect(migration).toContain("v_user_id uuid := (select auth.uid())");
    expect(migration).not.toMatch(/apply_helm_mutations\s*\([^)]*user_id/is);
    expect(migration).toContain('revoke execute on function public.apply_helm_mutations(uuid, jsonb) from public, anon');
  });

  it('uses private account Broadcast metadata and removes legacy table changes', () => {
    expect(migration).toContain("'helm:account:' || v_user_id::text");
    expect(migration).toContain("'helm_records_changed'");
    expect(migration).toContain("(select realtime.topic()) = 'helm:account:' || (select auth.uid())::text");
    expect(migration).toContain('alter publication supabase_realtime drop table public.kv_store');
    expect(migration).not.toMatch(/^\s*drop table public\.kv_store/mi);
  });

  it('has no production shared-store write fallback', () => {
    expect(persistence).not.toMatch(/localStorage\.setItem\(getDataKey/);
    expect(persistence).not.toMatch(/invoke\(['"]write_store['"],\s*\{\s*key\s*\}/);
    expect(persistence).not.toContain('SyncDriftModal');
    expect(persistence).toContain('hasUsableSnapshot');
    expect(persistence).toContain('readOnly');
    expect(persistence).toContain('requestDatabaseRefresh');
  });

  it('loads one account-scoped atomic snapshot without a row-limit loop', () => {
    expect(snapshotMigration).toContain('create or replace function public.get_helm_account_snapshot()');
    expect(snapshotMigration).toContain('security invoker');
    expect(snapshotMigration).toContain('where record.user_id = (select auth.uid())');
    expect(snapshotMigration).toContain('order by record.collection, record.record_id');
    expect(snapshotMigration).toContain('revoke all on function public.get_helm_account_snapshot() from public, anon');
    expect(snapshotMigration).toContain('grant execute on function public.get_helm_account_snapshot() to authenticated');
    expect(persistence).toContain('fetchHelmAccountSnapshot()');
  });

  it('keeps the mounted application after a safe snapshot becomes read-only', () => {
    expect(appRoot).toContain('syncSession.hasUsableSnapshot');
    expect(appRoot).toContain('<SyncStatusBanner syncSession={syncSession} />');
    expect(appRoot).toContain('<AppProvider key={auth.authUser.id}>');
    expect(appRoot).not.toContain('remoteGeneration');
    expect(appRoot).not.toContain('Sabah One is reconnecting');
  });

  it('stores secret values in Vault and exposes only account-derived RPCs', () => {
    expect(secretMigration).toContain('create extension if not exists supabase_vault with schema vault');
    expect(secretMigration).toContain('create table public.helm_secret_entries');
    expect(secretMigration).toContain('vault_secret_id uuid not null unique');
    expect(secretMigration).toContain('select vault.create_secret(');
    expect(secretMigration).toContain('join vault.decrypted_secrets');
    expect(secretMigration).toContain("v_user_id uuid := (select auth.uid())");
    expect(secretMigration).not.toMatch(/save_helm_secret\s*\([^)]*user_id/is);
    expect(secretMigration).toContain('revoke all on public.helm_secret_entries from public, anon, authenticated');
    expect(secretMigration).toContain('grant execute on function public.reveal_helm_secret(uuid) to authenticated');
  });

  it('broadcasts only secret identifiers and versions', () => {
    const broadcast = secretMigration.slice(secretMigration.indexOf('perform realtime.send('));
    expect(broadcast).toContain("'helm_secrets_changed'");
    expect(broadcast).toContain("'secretId', v_entry.secret_id");
    expect(broadcast).toContain("'accountVersion', v_next_version");
    expect(broadcast).not.toMatch(/'value'\s*,/);
    expect(broadcast).not.toContain('v_payload');
  });
});
