begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and (c.relname like 'life_hero%' or c.relname like 'github_life_hero%')),
  0,
  'no Life Hero or GitHub Life Hero table, index or sequence remains'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'helm_private') and p.proname like '%life_hero%'),
  0,
  'no Life Hero RPC or private helper remains'
);
select is(
  (select count(*)::integer from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'life_hero_initialize_profile'),
  0,
  'new accounts no longer initialise a Life Hero profile'
);
select is(
  (select count(*)::integer from pg_proc where prosrc like '%life_hero%'),
  0,
  'no remaining function body reads a Life Hero object'
);
select is(
  (select count(*)::integer from pg_proc where prosrc like '%prayer.outcome%'),
  0,
  'nothing left reads prayer.outcome for Life Hero'
);
select ok(
  strpos(pg_get_functiondef('helm_private.apply_helm_mutations_direct(uuid,jsonb)'::regprocedure), 'conversations') = 0
    and strpos(pg_get_functiondef('helm_private.apply_helm_mutations_direct(uuid,jsonb)'::regprocedure), 'assistantCorrections') = 0
    and strpos(pg_get_functiondef('helm_private.apply_helm_mutations_direct(uuid,jsonb)'::regprocedure), 'assistantActivityLog') = 0,
  'the mutation allowlist no longer names an assistant collection'
);
select ok(
  strpos(pg_get_functiondef('helm_private.apply_helm_mutations_direct(uuid,jsonb)'::regprocedure), '''employment''') > 0
    and strpos(pg_get_functiondef('helm_private.apply_helm_mutations_direct(uuid,jsonb)'::regprocedure), '''prayerTracking''') > 0
    and strpos(pg_get_functiondef('helm_private.apply_helm_mutations_direct(uuid,jsonb)'::regprocedure), '''settings''') > 0,
  'the mutation allowlist keeps the remaining collections'
);
select is(
  (select count(*)::integer from public.helm_records
   where collection in ('conversations', 'assistantCorrections', 'assistantActivityLog')),
  0,
  'no assistant account records remain'
);
select has_table('public', 'product_usage_events', 'product usage analytics is kept');

select * from finish();
rollback;
