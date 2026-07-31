create table if not exists public.kv_store (
  namespace text not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  -- This is the immutable legacy rollback source. Production contains an
  -- unauthenticated pre-account snapshot, so its original text owner is kept
  -- verbatim. Active HELM records use auth-owned UUIDs in helm_records.
  user_id text not null,
  constraint kv_store_pkey primary key (user_id, namespace, key)
);

alter table public.kv_store enable row level security;

drop policy if exists "User isolation" on public.kv_store;

create policy "User isolation"
on public.kv_store
for all
using (auth.uid()::text = user_id);
