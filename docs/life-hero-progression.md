# Life Hero Progression

KAN-258 establishes the permanent, database-authoritative progression foundation. KAN-262 adds a narrow database-authoritative source mapping boundary without adding the dashboard character, external evidence providers, voice, combat, or product-usage rewards.

## Permanent model

Ruleset `life-hero-v1` defines Faith, Vitality, Knowledge, Discipline, Finances, Craft, and Community. Evidence kinds, source confidence, the quadratic level curve, momentum thresholds, and condition timing are versioned in Postgres. A profile stays on its assigned ruleset so a later active ruleset cannot silently reduce an existing level.

The browser never supplies XP. It submits a bounded evidence type, owner-scoped source reference, idempotency key, occurrence time, local date, source tier, and flat non-sensitive metadata. `accept_life_hero_evidence` resolves the award from database rules and commits the evidence, immutable award snapshot, and derived profile in one transaction.

Duplicate protection uses both the owner idempotency key and the stable source identity. A retry returns the original receipt. Reusing an idempotency key for different evidence fails visibly.

## Progression rules

| Stat | Evidence kind | Base XP | Renewal prompt after |
| --- | --- | ---: | ---: |
| Faith | `faith_practice` | 20 | 1 day |
| Vitality | `vitality_activity` | 20 | 2 days |
| Knowledge | `knowledge_learning` | 20 | 3 days |
| Discipline | `discipline_commitment` | 15 | 2 days |
| Finances | `financial_progress` | 25 | 7 days |
| Craft | `craft_practice` | 20 | 7 days |
| Community | `community_service` | 25 | 7 days |

Verified and trusted-integration evidence uses a 1.0 source multiplier. Self-reported evidence uses 0.75. Consecutive evidence days for the same stat use momentum multipliers of 1.0, 1.1 from day 3, 1.25 from day 7, and 1.5 from day 14. Multiple actions on one local day do not create extra momentum days.

Level is `floor(sqrt(XP / 100)) + 1`. Profiles are deterministic projections of the immutable award ledger. Recomputing, inactivity, or a temporary condition never subtracts XP or lowers a level.

## Temporary conditions

`get_life_hero_snapshot` computes one motivational state per stat for the requested local date:

- `awaiting_first_step` when no evidence exists;
- `steady` while recent evidence is within the ruleset window;
- `renewal_due` after that window.

Conditions are not persisted into progression and have no mutation path to XP.

## Privacy and analytics boundary

All owner tables use RLS. Authenticated users can read only their rows and cannot insert, update, or delete progression tables directly. Anonymous roles cannot read the rules or execute Life Hero RPCs. Security-definer write functions pin an empty `search_path`, schema-qualify every object, derive the owner from `auth.uid()`, and reject anonymous sessions.

Metadata is limited to an 8 KiB flat scalar object and rejects credential-like keys. Raw provider payloads, tokens, secrets, cookies, and credentials do not belong in the ledger.

Product usage analytics has no evidence type, rule, client input, service mapping, or RPC capable of granting XP. Usage analytics may inform product decisions in a later ticket, but it remains separate from real-world progression.

## KAN-262 source mapping

`sync_life_hero_evidence` and its migration-time backfill read only active, account-owned `helm_records`. Backfill excludes `auth.users.is_anonymous` accounts. Every source local date must be on or before the requested `p_as_of_local_date`; future Prayer, Learn, Move, task, budget, savings-goal, and transaction records are skipped. Each accepted row keeps a stable `source_reference` plus flat metadata for `mappingVersion`, source collection, source record ID, source revision, source update time, and a deterministic reason. The same source identity is safe to replay.

| Source record | Hero evidence | Acceptance rule |
| --- | --- | --- |
| Canonical `prayerTracking` outcome | Faith | `on_time` or `late`; missed and unclassified outcomes are excluded |
| Daily Momentum Learn | Knowledge | Positive dated progress |
| Daily Momentum Move | Vitality | Positive dated progress |
| Completed non-prayer task | Discipline | Completed task record; prayer tasks remain owned by Prayer |
| Finance budget | Finances | Positive monthly budget limit |
| Savings goal | Finances | Positive current amount or completed goal |
| Finance transaction | Finances | Transfer into a savings account or lower/explicitly reduced avoidable spend; comparison reasons cite a prior amount that is greater than the accepted current amount |
| Monzo-imported transaction | Finances | Same financial-practice rules, with `trusted_integration` provenance from its stable `monzo:` tag |

Finance account balances, income, ordinary spend, wealth growth, and product-usage events never award XP. Mapping creates no negative evidence, so conditions can become `renewal_due` while permanent XP and levels remain unchanged.

The Life Hero companion calls the typed synchronization RPC immediately before its existing snapshot fetch. A synchronization failure uses the same fail-closed, retryable companion state as a snapshot failure, so stale or invented progress is never shown. External Life Hero access remains unavailable until the explicit MCP gap in `docs/agent-access.md` is implemented.

These controls follow the current Supabase guidance for [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions), and [Data API security](https://supabase.com/docs/guides/api/securing-your-api).

## Legacy handling

The migration captures an existing `gamification/profile` total and level only as `legacy_gamification_profile_unallocated`. It does not convert that summary into evidence or allocate it to a stat because doing so would guess history. Existing `GamificationProfile` storage and behavior remain unchanged.

## Verification and rollback

`npm run test:database` rebuilds the historical migration chain, proves owner and anonymous boundaries, duplicate identity, atomic award behavior, momentum snapshots, monotonic progress, conditions, deterministic recomputation, safe legacy capture, KAN-262 source mappings and replay suppression, and a non-destructive rollback/resume.

If awards must be paused, apply `supabase/rollback/20260830070000_pause_life_hero_progression.sql`. It revokes evidence and recomputation execution while preserving readable profiles, evidence, awards, and legacy snapshots. After the defect is fixed, apply `supabase/rollback/20260830070000_resume_life_hero_progression.sql`. No evidence replay is needed.
