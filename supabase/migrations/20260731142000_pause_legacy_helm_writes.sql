begin;

-- This migration is intentionally separate from the normalization migration.
-- Its commit is the cutover boundary: legacy clients can continue reading the
-- rollback snapshot, but no device can change it while the backup and account
-- manifests are captured.
revoke insert, update, delete, truncate on public.kv_store
from public, anon, authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'kv_store'
  ) then
    alter publication supabase_realtime drop table public.kv_store;
  end if;
end;
$$;

commit;
