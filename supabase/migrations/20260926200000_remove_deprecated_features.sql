-- Remove the deleted Life Hero, GitHub Life Hero and Lina assistant features from the database.
-- The browser, Edge Functions and deploy workflow no longer use any object dropped here.
-- Data in these objects is deleted permanently (owner decision, 2026-09-26: delete, do not migrate).
begin;

-- 1. GitHub Life Hero credentials live in Vault. Deleting each connection row fires the existing
--    BEFORE DELETE trigger that removes its Vault secret; DROP TABLE alone would orphan them.
delete from public.github_life_hero_connections;

-- 2. Stop initialising Life Hero profiles for new accounts.
drop trigger if exists life_hero_initialize_profile on auth.users;

-- 3. Public RPCs.
drop function if exists public.get_life_hero_snapshot(date);
drop function if exists public.sync_life_hero_evidence(date);
drop function if exists public.accept_life_hero_evidence(text, text, text, text, timestamptz, date, jsonb);
drop function if exists public.recompute_life_hero_profile(date);
drop function if exists public.accept_github_life_hero_evidence(uuid, jsonb, date);
drop function if exists public.save_github_life_hero_credential(uuid, bigint, text, text, timestamptz, timestamptz, bigint, text);
drop function if exists public.get_github_life_hero_credential(uuid);
drop function if exists public.set_github_life_hero_selection(uuid, bigint[]);
drop function if exists public.mark_github_life_hero_sync(uuid, text, text, text);
drop function if exists public.delete_github_life_hero_connection(uuid);

-- 4. Tables, dependants first. Their policies, indexes and table triggers are dropped with them.
drop table if exists public.github_life_hero_oauth_states;
drop table if exists public.github_life_hero_connections;
drop table if exists public.life_hero_awards;
drop table if exists public.life_hero_evidence;
drop table if exists public.life_hero_stat_profiles;
drop table if exists public.life_hero_profiles;
drop table if exists public.life_hero_legacy_snapshots;
drop table if exists public.life_hero_evidence_rules;
drop table if exists public.life_hero_source_tier_rules;
drop table if exists public.life_hero_momentum_rules;
drop table if exists public.life_hero_stat_rules;
drop table if exists public.life_hero_rulesets;

-- 5. Private helpers, now unreferenced.
drop function if exists helm_private.initialize_life_hero_profile_for_new_user();
drop function if exists helm_private.initialize_life_hero_profile(uuid);
drop function if exists helm_private.capture_life_hero_legacy_snapshot(uuid);
drop function if exists helm_private.recompute_life_hero_profile(uuid);
drop function if exists helm_private.life_hero_evidence_receipt(uuid, boolean, date);
drop function if exists helm_private.life_hero_level_from_xp(bigint, text);
drop function if exists helm_private.life_hero_try_date(text);
drop function if exists helm_private.life_hero_try_timestamptz(text);
drop function if exists helm_private.life_hero_local_date_in_zone(timestamptz, text);
drop function if exists helm_private.life_hero_daily_momentum_level(jsonb);
drop function if exists helm_private.delete_github_life_hero_vault_value();
drop function if exists helm_private.guard_github_trusted_life_hero_evidence();

-- 6. The Lina assistant's account collections: delete their records (tombstones included) and
--    stop accepting writes to them. The allowlist is rewritten in place, as
--    20260829181941_allow_employment_mutations did, and refuses to run if it has drifted.
delete from public.helm_records
where collection in ('conversations', 'assistantCorrections', 'assistantActivityLog');

do $migration$
declare
  v_definition text;
  v_first_needle constant text := $needle$    'settings', 'integrations', 'conversations',
$needle$;
  v_first_replacement constant text := $replacement$    'settings', 'integrations',
$replacement$;
  v_second_needle constant text := $needle$    'gamification', 'prayerTracking', 'assistantCorrections', 'assistantActivityLog',
$needle$;
  v_second_replacement constant text := $replacement$    'gamification', 'prayerTracking',
$replacement$;
begin
  select pg_get_functiondef(
    'helm_private.apply_helm_mutations_direct(uuid,jsonb)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, 'conversations') = 0
    and strpos(v_definition, 'assistantCorrections') = 0
    and strpos(v_definition, 'assistantActivityLog') = 0 then
    return;
  end if;

  if strpos(v_definition, v_first_needle) = 0 or strpos(v_definition, v_second_needle) = 0 then
    raise exception
      'apply_helm_mutations_direct allowed collection list has drifted; refusing an unsafe rewrite';
  end if;

  v_definition := replace(v_definition, v_first_needle, v_first_replacement);
  v_definition := replace(v_definition, v_second_needle, v_second_replacement);
  if strpos(v_definition, 'conversations') > 0
    or strpos(v_definition, 'assistantCorrections') > 0
    or strpos(v_definition, 'assistantActivityLog') > 0 then
    raise exception 'apply_helm_mutations_direct still names a removed assistant collection';
  end if;

  execute v_definition;
end;
$migration$;

-- 7. Product analytics stays; only its Life Hero wording goes.
comment on table public.product_usage_events is
  'Private owner-only Sabah One product events. Typed content-free analytics only.';

commit;
