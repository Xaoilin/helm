begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(3);

select hasnt_table('public', 'google_calendar_credentials', 'Google refresh tokens are no longer kept in Supabase');
select is(to_regprocedure('public.set_google_calendar_credentials_updated_at()'), null,
  'the credential table trigger function is gone');
select is(to_regprocedure('public.inventory_resolve_project(text)'), null,
  'projects are resolved by the knowledge service, not an RPC');

select * from finish();
rollback;
