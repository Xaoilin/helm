create table if not exists public.kv_store (
  user_id uuid not null references auth.users(id) on delete cascade,
  namespace text not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint kv_store_pkey primary key (user_id, namespace, key)
);

create index if not exists kv_store_user_namespace_idx
  on public.kv_store (user_id, namespace);

alter table public.kv_store enable row level security;

drop policy if exists "User isolation" on public.kv_store;

create policy "User isolation"
on public.kv_store
for all
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'kv_store'
  ) then
    alter publication supabase_realtime add table public.kv_store;
  end if;
end;
$$;
