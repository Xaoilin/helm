begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists helm_private;
revoke all on schema helm_private from public, anon, authenticated;

create table if not exists public.life_hero_rulesets (
  version text primary key check (version <> '' and length(version) <= 64),
  level_curve_factor integer not null check (level_curve_factor > 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists life_hero_one_active_ruleset_idx
  on public.life_hero_rulesets (is_active)
  where is_active;

create table if not exists public.life_hero_stat_rules (
  ruleset_version text not null references public.life_hero_rulesets(version) on delete restrict,
  stat text not null check (stat = any(array[
    'faith', 'vitality', 'knowledge', 'discipline', 'finances', 'craft', 'community'
  ])),
  attention_after_days integer not null check (attention_after_days >= 1),
  display_order smallint not null check (display_order between 1 and 7),
  constraint life_hero_stat_rules_pkey primary key (ruleset_version, stat),
  constraint life_hero_stat_rules_order_unique unique (ruleset_version, display_order)
);

create table if not exists public.life_hero_evidence_rules (
  ruleset_version text not null,
  evidence_type text not null check (evidence_type <> '' and length(evidence_type) <= 64),
  stat text not null,
  base_xp integer not null check (base_xp > 0),
  constraint life_hero_evidence_rules_pkey primary key (ruleset_version, evidence_type),
  constraint life_hero_evidence_rules_stat_fkey foreign key (ruleset_version, stat)
    references public.life_hero_stat_rules(ruleset_version, stat) on delete restrict
);

create table if not exists public.life_hero_source_tier_rules (
  ruleset_version text not null references public.life_hero_rulesets(version) on delete restrict,
  source_tier text not null check (source_tier = any(array[
    'verified', 'trusted_integration', 'self_reported'
  ])),
  xp_multiplier numeric(6,3) not null check (xp_multiplier > 0 and xp_multiplier <= 2),
  constraint life_hero_source_tier_rules_pkey primary key (ruleset_version, source_tier)
);

create table if not exists public.life_hero_momentum_rules (
  ruleset_version text not null references public.life_hero_rulesets(version) on delete restrict,
  minimum_days integer not null check (minimum_days >= 1),
  xp_multiplier numeric(6,3) not null check (xp_multiplier >= 1 and xp_multiplier <= 3),
  constraint life_hero_momentum_rules_pkey primary key (ruleset_version, minimum_days)
);

create table if not exists public.life_hero_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ruleset_version text not null references public.life_hero_rulesets(version) on delete restrict,
  total_xp bigint not null default 0 check (total_xp >= 0),
  overall_level integer not null default 1 check (overall_level >= 1),
  updated_at timestamptz not null default now(),
  recomputed_at timestamptz not null default now(),
  constraint life_hero_profiles_user_ruleset_unique unique (user_id, ruleset_version)
);

create table if not exists public.life_hero_stat_profiles (
  user_id uuid not null,
  ruleset_version text not null,
  stat text not null,
  total_xp bigint not null default 0 check (total_xp >= 0),
  level integer not null default 1 check (level >= 1),
  updated_at timestamptz not null default now(),
  constraint life_hero_stat_profiles_pkey primary key (user_id, stat),
  constraint life_hero_stat_profiles_profile_fkey foreign key (user_id, ruleset_version)
    references public.life_hero_profiles(user_id, ruleset_version) on delete cascade,
  constraint life_hero_stat_profiles_rule_fkey foreign key (ruleset_version, stat)
    references public.life_hero_stat_rules(ruleset_version, stat) on delete restrict
);

create table if not exists public.life_hero_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ruleset_version text not null,
  stat text not null,
  evidence_type text not null,
  source_tier text not null,
  source_reference text not null check (source_reference <> '' and length(source_reference) <= 512),
  idempotency_key text not null check (idempotency_key <> '' and length(idempotency_key) <= 256),
  occurred_at timestamptz not null,
  local_date date not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint life_hero_evidence_rule_fkey foreign key (ruleset_version, evidence_type)
    references public.life_hero_evidence_rules(ruleset_version, evidence_type) on delete restrict,
  constraint life_hero_evidence_stat_fkey foreign key (ruleset_version, stat)
    references public.life_hero_stat_rules(ruleset_version, stat) on delete restrict,
  constraint life_hero_evidence_source_tier_fkey foreign key (ruleset_version, source_tier)
    references public.life_hero_source_tier_rules(ruleset_version, source_tier) on delete restrict,
  constraint life_hero_evidence_user_idempotency_unique unique (user_id, idempotency_key),
  constraint life_hero_evidence_source_unique unique (
    user_id, ruleset_version, evidence_type, source_tier, source_reference
  ),
  constraint life_hero_evidence_id_user_unique unique (id, user_id)
);

create index if not exists life_hero_evidence_owner_stat_date_idx
  on public.life_hero_evidence (user_id, stat, local_date desc, occurred_at desc);

create table if not exists public.life_hero_awards (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  evidence_id uuid not null unique,
  ruleset_version text not null,
  stat text not null,
  base_xp integer not null check (base_xp > 0),
  source_multiplier numeric(6,3) not null check (source_multiplier > 0),
  momentum_days integer not null check (momentum_days >= 1),
  momentum_multiplier numeric(6,3) not null check (momentum_multiplier >= 1),
  awarded_xp integer not null check (awarded_xp > 0),
  momentum_snapshot jsonb not null check (jsonb_typeof(momentum_snapshot) = 'object'),
  awarded_at timestamptz not null default now(),
  constraint life_hero_awards_evidence_owner_fkey foreign key (evidence_id, user_id)
    references public.life_hero_evidence(id, user_id) on delete cascade,
  constraint life_hero_awards_stat_fkey foreign key (ruleset_version, stat)
    references public.life_hero_stat_rules(ruleset_version, stat) on delete restrict
);

create index if not exists life_hero_awards_owner_stat_idx
  on public.life_hero_awards (user_id, stat, awarded_at desc);

create table if not exists public.life_hero_legacy_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_collection text not null check (source_collection = 'gamification'),
  source_record_id text not null check (source_record_id = 'profile'),
  source_revision bigint not null check (source_revision > 0),
  source_updated_at timestamptz not null,
  source_total_xp bigint check (source_total_xp >= 0),
  source_level integer check (source_level >= 1),
  provenance text not null check (provenance = 'legacy_gamification_profile_unallocated'),
  captured_at timestamptz not null default now(),
  constraint life_hero_legacy_snapshot_has_value check (
    source_total_xp is not null or source_level is not null
  ),
  constraint life_hero_legacy_snapshots_source_unique unique (
    user_id, source_collection, source_record_id, source_revision
  )
);

insert into public.life_hero_rulesets (version, level_curve_factor, is_active)
values ('life-hero-v1', 100, true)
on conflict (version) do nothing;

insert into public.life_hero_stat_rules (
  ruleset_version, stat, attention_after_days, display_order
)
values
  ('life-hero-v1', 'faith', 1, 1),
  ('life-hero-v1', 'vitality', 2, 2),
  ('life-hero-v1', 'knowledge', 3, 3),
  ('life-hero-v1', 'discipline', 2, 4),
  ('life-hero-v1', 'finances', 7, 5),
  ('life-hero-v1', 'craft', 7, 6),
  ('life-hero-v1', 'community', 7, 7)
on conflict (ruleset_version, stat) do nothing;

insert into public.life_hero_evidence_rules (
  ruleset_version, evidence_type, stat, base_xp
)
values
  ('life-hero-v1', 'faith_practice', 'faith', 20),
  ('life-hero-v1', 'vitality_activity', 'vitality', 20),
  ('life-hero-v1', 'knowledge_learning', 'knowledge', 20),
  ('life-hero-v1', 'discipline_commitment', 'discipline', 15),
  ('life-hero-v1', 'financial_progress', 'finances', 25),
  ('life-hero-v1', 'craft_practice', 'craft', 20),
  ('life-hero-v1', 'community_service', 'community', 25)
on conflict (ruleset_version, evidence_type) do nothing;

insert into public.life_hero_source_tier_rules (
  ruleset_version, source_tier, xp_multiplier
)
values
  ('life-hero-v1', 'verified', 1.000),
  ('life-hero-v1', 'trusted_integration', 1.000),
  ('life-hero-v1', 'self_reported', 0.750)
on conflict (ruleset_version, source_tier) do nothing;

insert into public.life_hero_momentum_rules (
  ruleset_version, minimum_days, xp_multiplier
)
values
  ('life-hero-v1', 1, 1.000),
  ('life-hero-v1', 3, 1.100),
  ('life-hero-v1', 7, 1.250),
  ('life-hero-v1', 14, 1.500)
on conflict (ruleset_version, minimum_days) do nothing;

alter table public.life_hero_rulesets enable row level security;
alter table public.life_hero_stat_rules enable row level security;
alter table public.life_hero_evidence_rules enable row level security;
alter table public.life_hero_source_tier_rules enable row level security;
alter table public.life_hero_momentum_rules enable row level security;
alter table public.life_hero_profiles enable row level security;
alter table public.life_hero_stat_profiles enable row level security;
alter table public.life_hero_evidence enable row level security;
alter table public.life_hero_awards enable row level security;
alter table public.life_hero_legacy_snapshots enable row level security;

drop policy if exists "Authenticated users can read Life Hero rulesets" on public.life_hero_rulesets;
create policy "Authenticated users can read Life Hero rulesets"
on public.life_hero_rulesets for select to authenticated using (true);
drop policy if exists "Authenticated users can read Life Hero stat rules" on public.life_hero_stat_rules;
create policy "Authenticated users can read Life Hero stat rules"
on public.life_hero_stat_rules for select to authenticated using (true);
drop policy if exists "Authenticated users can read Life Hero evidence rules" on public.life_hero_evidence_rules;
create policy "Authenticated users can read Life Hero evidence rules"
on public.life_hero_evidence_rules for select to authenticated using (true);
drop policy if exists "Authenticated users can read Life Hero source tiers" on public.life_hero_source_tier_rules;
create policy "Authenticated users can read Life Hero source tiers"
on public.life_hero_source_tier_rules for select to authenticated using (true);
drop policy if exists "Authenticated users can read Life Hero momentum rules" on public.life_hero_momentum_rules;
create policy "Authenticated users can read Life Hero momentum rules"
on public.life_hero_momentum_rules for select to authenticated using (true);

drop policy if exists "Life Hero profiles are private" on public.life_hero_profiles;
create policy "Life Hero profiles are private"
on public.life_hero_profiles for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists "Life Hero stat profiles are private" on public.life_hero_stat_profiles;
create policy "Life Hero stat profiles are private"
on public.life_hero_stat_profiles for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists "Life Hero evidence is private" on public.life_hero_evidence;
create policy "Life Hero evidence is private"
on public.life_hero_evidence for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists "Life Hero awards are private" on public.life_hero_awards;
create policy "Life Hero awards are private"
on public.life_hero_awards for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists "Life Hero legacy snapshots are private" on public.life_hero_legacy_snapshots;
create policy "Life Hero legacy snapshots are private"
on public.life_hero_legacy_snapshots for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

revoke all on table
  public.life_hero_rulesets,
  public.life_hero_stat_rules,
  public.life_hero_evidence_rules,
  public.life_hero_source_tier_rules,
  public.life_hero_momentum_rules,
  public.life_hero_profiles,
  public.life_hero_stat_profiles,
  public.life_hero_evidence,
  public.life_hero_awards,
  public.life_hero_legacy_snapshots
from public, anon, authenticated;

grant select on table
  public.life_hero_rulesets,
  public.life_hero_stat_rules,
  public.life_hero_evidence_rules,
  public.life_hero_source_tier_rules,
  public.life_hero_momentum_rules,
  public.life_hero_profiles,
  public.life_hero_stat_profiles,
  public.life_hero_evidence,
  public.life_hero_awards,
  public.life_hero_legacy_snapshots
to authenticated;

create or replace function helm_private.life_hero_level_from_xp(
  p_total_xp bigint,
  p_ruleset_version text
)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select floor(sqrt(
    greatest(p_total_xp, 0)::numeric / ruleset.level_curve_factor::numeric
  ))::integer + 1
  from public.life_hero_rulesets as ruleset
  where ruleset.version = p_ruleset_version
$$;

revoke all on function helm_private.life_hero_level_from_xp(bigint, text)
from public, anon, authenticated;

create or replace function helm_private.initialize_life_hero_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ruleset_version text;
begin
  select version into v_ruleset_version
  from public.life_hero_rulesets
  where is_active
  order by created_at desc
  limit 1;

  if v_ruleset_version is null then
    raise exception 'Life Hero has no active ruleset.' using errcode = '55000';
  end if;

  insert into public.life_hero_profiles (user_id, ruleset_version)
  values (p_user_id, v_ruleset_version)
  on conflict (user_id) do nothing;

  insert into public.life_hero_stat_profiles (user_id, ruleset_version, stat)
  select profile.user_id, profile.ruleset_version, rule.stat
  from public.life_hero_profiles as profile
  join public.life_hero_stat_rules as rule
    on rule.ruleset_version = profile.ruleset_version
  where profile.user_id = p_user_id
  on conflict (user_id, stat) do nothing;
end;
$$;

revoke all on function helm_private.initialize_life_hero_profile(uuid)
from public, anon, authenticated;

create or replace function helm_private.initialize_life_hero_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform helm_private.initialize_life_hero_profile(new.id);
  return new;
end;
$$;

revoke all on function helm_private.initialize_life_hero_profile_for_new_user()
from public, anon, authenticated;

drop trigger if exists life_hero_initialize_profile on auth.users;
create trigger life_hero_initialize_profile
after insert on auth.users
for each row execute function helm_private.initialize_life_hero_profile_for_new_user();

do $initialize_existing_profiles$
declare
  v_user_id uuid;
begin
  for v_user_id in select id from auth.users loop
    perform helm_private.initialize_life_hero_profile(v_user_id);
  end loop;
end;
$initialize_existing_profiles$;

create or replace function helm_private.capture_life_hero_legacy_snapshot(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.helm_records%rowtype;
  v_total_xp numeric;
  v_level numeric;
begin
  select * into v_record
  from public.helm_records
  where user_id = p_user_id
    and collection = 'gamification'
    and record_id = 'profile'
    and deleted_at is null;

  if not found then return; end if;

  if jsonb_typeof(v_record.payload -> 'totalXp') = 'number' then
    v_total_xp := (v_record.payload ->> 'totalXp')::numeric;
    if v_total_xp < 0 or v_total_xp > 9007199254740991 or trunc(v_total_xp) <> v_total_xp then
      v_total_xp := null;
    end if;
  end if;
  if jsonb_typeof(v_record.payload -> 'level') = 'number' then
    v_level := (v_record.payload ->> 'level')::numeric;
    if v_level < 1 or v_level > 2147483647 or trunc(v_level) <> v_level then
      v_level := null;
    end if;
  end if;
  if v_total_xp is null and v_level is null then return; end if;

  insert into public.life_hero_legacy_snapshots (
    user_id,
    source_collection,
    source_record_id,
    source_revision,
    source_updated_at,
    source_total_xp,
    source_level,
    provenance
  )
  values (
    p_user_id,
    'gamification',
    'profile',
    v_record.revision,
    v_record.updated_at,
    v_total_xp::bigint,
    v_level::integer,
    'legacy_gamification_profile_unallocated'
  )
  on conflict (user_id, source_collection, source_record_id, source_revision) do nothing;
end;
$$;

revoke all on function helm_private.capture_life_hero_legacy_snapshot(uuid)
from public, anon, authenticated;

do $capture_existing_legacy_profiles$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select user_id
    from public.helm_records
    where collection = 'gamification'
      and record_id = 'profile'
      and deleted_at is null
  loop
    perform helm_private.capture_life_hero_legacy_snapshot(v_user_id);
  end loop;
end;
$capture_existing_legacy_profiles$;

create or replace function helm_private.recompute_life_hero_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ruleset_version text;
  v_total_xp bigint;
begin
  perform helm_private.initialize_life_hero_profile(p_user_id);

  select ruleset_version into v_ruleset_version
  from public.life_hero_profiles
  where user_id = p_user_id
  for update;

  insert into public.life_hero_stat_profiles (
    user_id, ruleset_version, stat, total_xp, level, updated_at
  )
  select
    p_user_id,
    v_ruleset_version,
    rule.stat,
    coalesce(sum(award.awarded_xp), 0)::bigint,
    helm_private.life_hero_level_from_xp(
      coalesce(sum(award.awarded_xp), 0)::bigint,
      v_ruleset_version
    ),
    now()
  from public.life_hero_stat_rules as rule
  left join public.life_hero_awards as award
    on award.user_id = p_user_id
   and award.stat = rule.stat
  where rule.ruleset_version = v_ruleset_version
  group by rule.stat
  on conflict (user_id, stat) do update set
    ruleset_version = excluded.ruleset_version,
    total_xp = excluded.total_xp,
    level = excluded.level,
    updated_at = excluded.updated_at;

  select coalesce(sum(total_xp), 0)::bigint into v_total_xp
  from public.life_hero_stat_profiles
  where user_id = p_user_id;

  update public.life_hero_profiles
  set total_xp = v_total_xp,
      overall_level = helm_private.life_hero_level_from_xp(v_total_xp, v_ruleset_version),
      updated_at = now(),
      recomputed_at = now()
  where user_id = p_user_id;
end;
$$;

revoke all on function helm_private.recompute_life_hero_profile(uuid)
from public, anon, authenticated;

create or replace function public.get_life_hero_snapshot(
  p_as_of_local_date date default current_date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_profile public.life_hero_profiles%rowtype;
  v_stats jsonb;
  v_activity jsonb;
begin
  if v_user_id is null then
    raise exception 'A signed-in Sabah One account is required.' using errcode = '42501';
  end if;
  if p_as_of_local_date is null then
    raise exception 'A Life Hero local date is required.' using errcode = '22023';
  end if;

  select * into v_profile
  from public.life_hero_profiles
  where user_id = v_user_id;
  if not found then
    raise exception 'The Life Hero profile is not initialized.' using errcode = '55000';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'stat', rule.stat,
      'totalXp', coalesce(profile.total_xp, 0),
      'level', coalesce(profile.level, 1),
      'lastEvidenceLocalDate', latest.local_date,
      'condition', case
        when latest.local_date is null then 'awaiting_first_step'
        when p_as_of_local_date - latest.local_date > rule.attention_after_days then 'renewal_due'
        else 'steady'
      end,
      'attentionAfterDays', rule.attention_after_days
    )
    order by rule.display_order
  ) into v_stats
  from public.life_hero_stat_rules as rule
  left join public.life_hero_stat_profiles as profile
    on profile.user_id = v_user_id
   and profile.stat = rule.stat
  left join lateral (
    select max(evidence.local_date) as local_date
    from public.life_hero_evidence as evidence
    where evidence.user_id = v_user_id
      and evidence.stat = rule.stat
      and evidence.local_date <= p_as_of_local_date
  ) as latest on true
  where rule.ruleset_version = v_profile.ruleset_version;

  select coalesce(jsonb_agg(activity.item order by activity.occurred_at desc), '[]'::jsonb)
  into v_activity
  from (
    select
      evidence.occurred_at,
      jsonb_build_object(
        'evidence', jsonb_build_object(
          'id', evidence.id,
          'rulesetVersion', evidence.ruleset_version,
          'stat', evidence.stat,
          'evidenceType', evidence.evidence_type,
          'sourceTier', evidence.source_tier,
          'sourceReference', evidence.source_reference,
          'idempotencyKey', evidence.idempotency_key,
          'occurredAt', evidence.occurred_at,
          'localDate', evidence.local_date,
          'metadata', evidence.metadata,
          'createdAt', evidence.created_at
        ),
        'award', jsonb_build_object(
          'id', award.id,
          'evidenceId', award.evidence_id,
          'rulesetVersion', award.ruleset_version,
          'stat', award.stat,
          'baseXp', award.base_xp,
          'sourceMultiplier', award.source_multiplier,
          'momentumDays', award.momentum_days,
          'momentumMultiplier', award.momentum_multiplier,
          'awardedXp', award.awarded_xp,
          'awardedAt', award.awarded_at
        )
      ) as item
    from public.life_hero_evidence as evidence
    join public.life_hero_awards as award on award.evidence_id = evidence.id
    where evidence.user_id = v_user_id
    order by evidence.occurred_at desc, evidence.created_at desc
    limit 50
  ) as activity;

  return jsonb_build_object(
    'rulesetVersion', v_profile.ruleset_version,
    'totalXp', v_profile.total_xp,
    'overallLevel', v_profile.overall_level,
    'updatedAt', v_profile.updated_at,
    'recomputedAt', v_profile.recomputed_at,
    'stats', coalesce(v_stats, '[]'::jsonb),
    'recentActivity', v_activity
  );
end;
$$;

revoke all on function public.get_life_hero_snapshot(date) from public, anon;
grant execute on function public.get_life_hero_snapshot(date) to authenticated;

create or replace function helm_private.life_hero_evidence_receipt(
  p_evidence_id uuid,
  p_duplicate boolean,
  p_as_of_local_date date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'duplicate', p_duplicate,
    'evidence', jsonb_build_object(
      'id', evidence.id,
      'rulesetVersion', evidence.ruleset_version,
      'stat', evidence.stat,
      'evidenceType', evidence.evidence_type,
      'sourceTier', evidence.source_tier,
      'sourceReference', evidence.source_reference,
      'idempotencyKey', evidence.idempotency_key,
      'occurredAt', evidence.occurred_at,
      'localDate', evidence.local_date,
      'metadata', evidence.metadata,
      'createdAt', evidence.created_at
    ),
    'award', jsonb_build_object(
      'id', award.id,
      'evidenceId', award.evidence_id,
      'rulesetVersion', award.ruleset_version,
      'stat', award.stat,
      'baseXp', award.base_xp,
      'sourceMultiplier', award.source_multiplier,
      'momentumDays', award.momentum_days,
      'momentumMultiplier', award.momentum_multiplier,
      'awardedXp', award.awarded_xp,
      'awardedAt', award.awarded_at
    ),
    'snapshot', public.get_life_hero_snapshot(p_as_of_local_date)
  )
  from public.life_hero_evidence as evidence
  join public.life_hero_awards as award on award.evidence_id = evidence.id
  where evidence.id = p_evidence_id
    and evidence.user_id = (select auth.uid())
$$;

revoke all on function helm_private.life_hero_evidence_receipt(uuid, boolean, date)
from public, anon, authenticated;

create or replace function public.accept_life_hero_evidence(
  p_idempotency_key text,
  p_evidence_type text,
  p_source_tier text,
  p_source_reference text,
  p_occurred_at timestamptz,
  p_local_date date,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '3s'
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_ruleset_version text;
  v_stat text;
  v_base_xp integer;
  v_source_multiplier numeric(6,3);
  v_previous_local_date date;
  v_previous_momentum_days integer;
  v_momentum_days integer := 1;
  v_momentum_multiplier numeric(6,3);
  v_awarded_xp integer;
  v_evidence_id uuid := extensions.gen_random_uuid();
  v_existing public.life_hero_evidence%rowtype;
  v_metadata_entry record;
begin
  if v_user_id is null then
    raise exception 'A signed-in Sabah One account is required.' using errcode = '42501';
  end if;
  if coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'Anonymous sessions cannot award Life Hero progress.' using errcode = '42501';
  end if;
  p_idempotency_key := btrim(coalesce(p_idempotency_key, ''));
  p_evidence_type := btrim(coalesce(p_evidence_type, ''));
  p_source_tier := btrim(coalesce(p_source_tier, ''));
  p_source_reference := btrim(coalesce(p_source_reference, ''));
  if p_idempotency_key = '' or length(p_idempotency_key) > 256 then
    raise exception 'Life Hero evidence needs a bounded idempotency key.' using errcode = '22023';
  end if;
  if p_source_reference = '' or length(p_source_reference) > 512 then
    raise exception 'Life Hero evidence needs a bounded source reference.' using errcode = '22023';
  end if;
  if p_occurred_at is null or p_local_date is null then
    raise exception 'Life Hero evidence needs occurrence and local dates.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata) <> 'object' or octet_length(p_metadata::text) > 8192 then
    raise exception 'Life Hero evidence metadata must be a small object.' using errcode = '22023';
  end if;
  for v_metadata_entry in select key, value from jsonb_each(p_metadata) loop
    if v_metadata_entry.key ~* '(authorization|cookie|credential|password|raw|secret|token)'
      or jsonb_typeof(v_metadata_entry.value) not in ('string', 'number', 'boolean', 'null')
    then
      raise exception 'Life Hero evidence metadata must be flat and exclude sensitive fields.'
        using errcode = '22023';
    end if;
  end loop;

  perform helm_private.initialize_life_hero_profile(v_user_id);
  select ruleset_version into v_ruleset_version
  from public.life_hero_profiles
  where user_id = v_user_id
  for update;

  select evidence_rule.stat, evidence_rule.base_xp, source_rule.xp_multiplier
  into v_stat, v_base_xp, v_source_multiplier
  from public.life_hero_evidence_rules as evidence_rule
  join public.life_hero_source_tier_rules as source_rule
    on source_rule.ruleset_version = evidence_rule.ruleset_version
   and source_rule.source_tier = p_source_tier
  where evidence_rule.ruleset_version = v_ruleset_version
    and evidence_rule.evidence_type = p_evidence_type;
  if not found then
    raise exception 'This evidence type or source tier cannot award Life Hero XP.'
      using errcode = '22023';
  end if;

  select * into v_existing
  from public.life_hero_evidence
  where user_id = v_user_id
    and (
      idempotency_key = p_idempotency_key
      or (
        ruleset_version = v_ruleset_version
        and evidence_type = p_evidence_type
        and source_tier = p_source_tier
        and source_reference = p_source_reference
      )
    )
  order by (idempotency_key = p_idempotency_key) desc
  limit 1;

  if found then
    if v_existing.idempotency_key = p_idempotency_key and (
      v_existing.evidence_type <> p_evidence_type
      or v_existing.source_tier <> p_source_tier
      or v_existing.source_reference <> p_source_reference
      or v_existing.occurred_at <> p_occurred_at
      or v_existing.local_date <> p_local_date
    ) then
      raise exception 'The Life Hero idempotency key was already used for different evidence.'
        using errcode = '23505';
    end if;
    return helm_private.life_hero_evidence_receipt(v_existing.id, true, p_local_date);
  end if;

  select evidence.local_date, award.momentum_days
  into v_previous_local_date, v_previous_momentum_days
  from public.life_hero_awards as award
  join public.life_hero_evidence as evidence on evidence.id = award.evidence_id
  where award.user_id = v_user_id
    and award.stat = v_stat
    and evidence.local_date <= p_local_date
  order by evidence.local_date desc, evidence.occurred_at desc, award.awarded_at desc
  limit 1;

  if found then
    if v_previous_local_date = p_local_date then
      v_momentum_days := v_previous_momentum_days;
    elsif v_previous_local_date = p_local_date - 1 then
      v_momentum_days := v_previous_momentum_days + 1;
    end if;
  end if;

  select xp_multiplier into v_momentum_multiplier
  from public.life_hero_momentum_rules
  where ruleset_version = v_ruleset_version
    and minimum_days <= v_momentum_days
  order by minimum_days desc
  limit 1;
  if v_momentum_multiplier is null then
    raise exception 'The Life Hero momentum ruleset is incomplete.' using errcode = '55000';
  end if;

  v_awarded_xp := greatest(1, round(
    v_base_xp::numeric * v_source_multiplier * v_momentum_multiplier
  )::integer);

  insert into public.life_hero_evidence (
    id,
    user_id,
    ruleset_version,
    stat,
    evidence_type,
    source_tier,
    source_reference,
    idempotency_key,
    occurred_at,
    local_date,
    metadata
  ) values (
    v_evidence_id,
    v_user_id,
    v_ruleset_version,
    v_stat,
    p_evidence_type,
    p_source_tier,
    p_source_reference,
    p_idempotency_key,
    p_occurred_at,
    p_local_date,
    p_metadata
  );

  insert into public.life_hero_awards (
    user_id,
    evidence_id,
    ruleset_version,
    stat,
    base_xp,
    source_multiplier,
    momentum_days,
    momentum_multiplier,
    awarded_xp,
    momentum_snapshot
  ) values (
    v_user_id,
    v_evidence_id,
    v_ruleset_version,
    v_stat,
    v_base_xp,
    v_source_multiplier,
    v_momentum_days,
    v_momentum_multiplier,
    v_awarded_xp,
    jsonb_build_object(
      'rulesetVersion', v_ruleset_version,
      'previousLocalDate', v_previous_local_date,
      'momentumDays', v_momentum_days,
      'multiplier', v_momentum_multiplier
    )
  );

  perform helm_private.recompute_life_hero_profile(v_user_id);
  return helm_private.life_hero_evidence_receipt(v_evidence_id, false, p_local_date);
end;
$$;

revoke all on function public.accept_life_hero_evidence(
  text, text, text, text, timestamptz, date, jsonb
) from public, anon;
grant execute on function public.accept_life_hero_evidence(
  text, text, text, text, timestamptz, date, jsonb
) to authenticated;

create or replace function public.recompute_life_hero_profile(
  p_as_of_local_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '3s'
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'A signed-in Sabah One account is required.' using errcode = '42501';
  end if;
  if coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'Anonymous sessions cannot recompute Life Hero progress.' using errcode = '42501';
  end if;
  if p_as_of_local_date is null then
    raise exception 'A Life Hero local date is required.' using errcode = '22023';
  end if;
  perform helm_private.recompute_life_hero_profile(v_user_id);
  return public.get_life_hero_snapshot(p_as_of_local_date);
end;
$$;

revoke all on function public.recompute_life_hero_profile(date) from public, anon;
grant execute on function public.recompute_life_hero_profile(date) to authenticated;

comment on table public.life_hero_evidence is
  'Append-only owner evidence accepted by a bounded RPC. Product usage analytics has no award rule or mutation path.';
comment on table public.life_hero_awards is
  'Immutable application award ledger with ruleset, source, and momentum snapshots.';
comment on table public.life_hero_legacy_snapshots is
  'Provenance-only legacy gamification snapshots. These rows never grant or allocate Life Hero XP.';
comment on function public.accept_life_hero_evidence(text, text, text, text, timestamptz, date, jsonb) is
  'Atomically accepts owner evidence and creates one idempotent Life Hero award from database-owned rules.';
comment on function public.get_life_hero_snapshot(date) is
  'Returns permanent owner progression plus temporary computed conditions that never subtract XP.';

commit;
