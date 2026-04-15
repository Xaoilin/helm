create table if not exists public.google_calendar_credentials (
  user_id uuid not null references auth.users(id) on delete cascade,
  google_email text not null,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  scope text,
  credential_origin text not null default 'oauth_code',
  last_refresh_at timestamptz,
  last_refresh_failure_reason text,
  last_refresh_failure_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint google_calendar_credentials_pkey primary key (user_id, google_email),
  constraint google_calendar_credentials_origin_check check (
    credential_origin in ('oauth_code', 'profile_session')
  )
);

create index if not exists google_calendar_credentials_user_id_idx
  on public.google_calendar_credentials (user_id);

alter table public.google_calendar_credentials enable row level security;

create or replace function public.set_google_calendar_credentials_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists google_calendar_credentials_set_updated_at
  on public.google_calendar_credentials;

create trigger google_calendar_credentials_set_updated_at
before update on public.google_calendar_credentials
for each row
execute function public.set_google_calendar_credentials_updated_at();
