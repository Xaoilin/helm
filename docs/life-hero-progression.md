# Life Hero Progression

KAN-258 establishes the permanent, database-authoritative progression foundation. It does not add the dashboard character, external evidence providers, voice, combat, or product-usage rewards.

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

## Existing Sabah One evidence sync

`sync_life_hero_evidence` scans only the signed-in account's database-authoritative Sabah One records. The migration runs it once for existing accounts, and the Life Hero companion runs it before reading a snapshot and again when a relevant account collection changes. A deterministic idempotency key and stable source reference make backfill and repeated reconciliation safe: accepted source evidence becomes immutable even if a mutable source record is later reset or removed.

All current account-record adapters use the conservative `self_reported` source tier. Database authority establishes ownership and durability; it does not turn a user-entered action into external verification.

| Sabah One source | Qualifying behavior | Hero mapping | Auditable reason |
| --- | --- | --- | --- |
| Prayer outcomes | Explicit `on_time` or `late` completion; missed, pending, reminders, and prayer tasks do not award | Faith / `faith_practice` | `prayer_completed_on_time` or `prayer_completed_late` |
| Learn momentum | An activity reaches cumulative level 1 or higher for its local date | Knowledge / `knowledge_learning` | `learn_target_completed` |
| Move momentum | An activity reaches cumulative level 1 or higher for its local date | Vitality / `vitality_activity` | `move_target_completed` |
| Sabah One tasks and goal tasks | A non-prayer task has an explicit completion timestamp | Discipline / `discipline_commitment` | `task_completed` or `goal_completed` |
| Budgets | A bounded category budget is created | Finances / `financial_progress` | `budget_created` |
| Savings goals | A goal is started, records positive progress, or is completed | Finances / `financial_progress` | `savings_goal_started`, `savings_progress_recorded`, or `savings_goal_completed` |
| Finance and Monzo-backed transactions | A transfer targets a savings account, or a completed month has lower avoidable-category spend than the prior month | Finances / `financial_progress` | `transfer_to_savings` or `avoidable_spend_improved` |

Finance evidence records behavior and milestone identity, never award amount from balances, income, net worth, target size, or absolute savings. Monzo tags remain provenance inside the same finance rules; importing a provider record does not itself award XP and no raw provider payload or amount enters Life Hero metadata.

New task completions persist `completedLocalDate` and the IANA `completionTimeZone` alongside the UTC completion instant. Recurring tasks reuse their task ID but receive one stable source identity per explicit local completion date. Existing task records without those fields fall back first to a persisted completion zone, then the account app time zone, and finally UTC; their stable legacy identity is derived from the original completion instant so a later time-zone preference change cannot duplicate an award. Savings progress uses the goal's `updatedAt`, then the database record update time, with creation time only as a legacy fallback.

Prayer weakness remains renewable. Positive Prayer evidence permanently increases Faith; later missed or absent evidence can only make the computed condition `renewal_due`. It never deletes an award or lowers XP or level.

These controls follow the current Supabase guidance for [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions), and [Data API security](https://supabase.com/docs/guides/api/securing-your-api).

## Legacy handling

The migration captures an existing `gamification/profile` total and level only as `legacy_gamification_profile_unallocated`. It does not convert that summary into evidence or allocate it to a stat because doing so would guess history. Existing `GamificationProfile` storage and behavior remain unchanged.

## Verification and rollback

`npm run test:database` rebuilds the historical migration chain, proves owner and anonymous boundaries, duplicate identity, atomic award behavior, source mappings, finance behavior boundaries, idempotent reconciliation, momentum snapshots, monotonic progress, conditions, deterministic recomputation, safe legacy capture, and a non-destructive rollback/resume.

If awards must be paused, apply `supabase/rollback/20260830070000_pause_life_hero_progression.sql`. It revokes evidence and recomputation execution while preserving readable profiles, evidence, awards, and legacy snapshots. After the defect is fixed, apply `supabase/rollback/20260830070000_resume_life_hero_progression.sql`. No evidence replay is needed.
