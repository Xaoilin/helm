# Account view preferences

Requested on 5 November 2026: presentation choices such as the Prayer challenge Day/Week/Month selection follow the signed-in account across devices.

The profile service owns `GET /api/profile/v1/view-preferences` (`{values:{...}}`) and `PUT /api/profile/v1/view-preferences/{key}` (`{value:"..."}` → `{key,value,updatedAt}`). Writes use the existing RabbitMQ command inbox and Idempotency-Key receipts. Each account/key has a separate row, so changing one control cannot replace an unrelated choice from another device. A native atomic upsert also handles simultaneous first saves of the same key. The latest committed choice wins for that key.

Keys and values are allowlisted in `app.profile.view-preferences.allowed-values`. The two products have independent registries and databases. Arbitrary searches, notes, drafts, dates, credentials and account-record IDs cannot be stored through this endpoint. Reads create no defaults and omit retired/invalid choices. The table is in the private profile schema, has RLS enabled without browser policies, and grants no PUBLIC access; the service owner and verified request identity enforce account ownership. OAuth-client tokens are refused until a dedicated preference agent boundary is available.

## Query and index scope

The only index is the required composite primary key `(user_id, preference_key)`. Account reads filter on its first column and order by its second; upserts address the complete key. Another index would duplicate that coverage. `ViewPreferencesQueryPlanTest` exercises both exact query shapes with 6,400 invented temporary rows, a five-second statement limit and rollback, recording `EXPLAIN (ANALYZE, BUFFERS)` evidence. It touches no hosted accounts. Revisit the plan if the registry or read shape grows substantially.

## Consumer and acceptance boundary

The browser loads the account's values once, reloads them after profile live events or focus, and saves only explicit changes. It shows confirmed choices, retains failed intents for the visible Retry preferences action, serializes pending saves, and rejects stale requests after an account change or unmount. No view preferences are stored in localStorage or sessionStorage. Calendar and its Settings selector share one key, with the old defaultCalendarTab used only while that key has no saved value.

Shared fixtures `profile-service/view-preferences.json` and `view-preference-updated.json` are checked by the service and consumer. Synthetic tests cover separate accounts, independent keys, concurrent first saves, idempotency, denied agent tokens and unsupported values. No actual account preferences are inspected by agents during implementation or validation.

A narrow external get/set view-preferences MCP capability is not yet published. External-agent acceptance remains an explicit gap; another domain's OAuth approval, direct API/database access, UI automation or copied session tokens are not substitutes.

## Sabah presentation inventory

| Surface | Saved choices |
| --- | --- |
| prayerChallenge | period |
| dashboard | learnIndividualSteps, moveIndividualSteps, showPrayerLog |
| calendar | view |
| tasks | tab, showCompletedGoals, category, priority, status |
| knowledge | tab, sourceFilter, searchSourceFilter |
| employment | activeOnly, showFilters, status, workType, remoteStatus |
| finance | tab, filterType |
| inventory | view, category |
| secrets | kindFilter, showArchived |
| trips | tab |
| projects | tab |
| debug | tab |
| activity | rangeDays, kind, surface, outcome |

Main navigation and record selections, search text, date offsets, modal/form state, list-derived accordions, dynamic project/topic/location filters, and loan-calculation inputs remain transient. Existing service-owned theme, prayer, notification and clock settings keep their existing owners. The account preference registry does not enable a retired or sibling-only screen.
