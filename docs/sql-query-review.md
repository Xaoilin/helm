# SQL query and index review

Every new or changed SQL query, including SQL produced by the Supabase client,
must be reviewed against existing indexes and representative query plans.

1. Record the caller, account/authentication scope, filters, joins, ordering,
   limits and expected cardinality. Include tombstones when the contract does.
2. Inspect the actual target's index definitions, including column order,
   predicates and uniqueness; compare them with migrations. Do not add a
   duplicate or infer that an index is unused from a recently reset counter.
3. Use bounded `EXPLAIN (ANALYZE, BUFFERS)` on representative synthetic data in
   an authorized test environment. Preserve the exact query and fixture size;
   distinguish SQL-body measurements from complete RPC/RLS/network acceptance.
   `ANALYZE` executes the statement. Production inspection must be explicitly
   authorized and bounded; never export private rows or reset statistics for
   this review.
4. Add a missing index only when a comparable before/after plan and timing show
   worthwhile benefit at a relevant workload. Account for storage, write
   maintenance, selectivity, ordering, build locks and existing coverage.
   Record a justified no-index decision when that is the better result.
5. Keep the receipt with the change: source query, existing indexes, environment,
   cardinality, plans/timings, decision and revisit trigger. Ship justified DDL
   through a reviewed migration and the normal protected release path.

Supabase's [index guide](https://supabase.com/docs/guides/database/postgres/indexes)
explains planner choice and index overhead; its
[query optimization guide](https://supabase.com/docs/guides/database/query-optimization)
describes plan inspection.

## KAN-320 review — 23 September 2026

Reviewed the final KAN-318/319 read paths at `9006d210de276a37e9f8201295c8da4ce0eb99a7`
(v0.2.169). Production catalogue readback at 2026-09-22 23:37 UTC confirmed
PostgreSQL 17.6 and these B-tree indexes:

| Table / index | Keys and predicate | Allocated bytes |
| --- | --- | ---: |
| `helm_account_state_pkey` | `user_id` (unique) | 16,384 |
| `helm_records_pkey` | `user_id, collection, record_id` (unique) | 450,560 |
| `helm_records_active_collection_position_idx` | `user_id, collection, position, record_id` where `deleted_at IS NULL` | 499,712 |
| `helm_records_account_version_idx` | `user_id, account_version` | 90,112 |
| `helm_secret_entries_pkey` | `user_id, secret_id` (unique) | 16,384 |
| `helm_secret_entries_active_label_idx` | `user_id, lower(label), secret_id` where `archived_at IS NULL` | 16,384 |
| `helm_secret_entries_source_ref_unique` | `user_id, source_ref` (unique) | 16,384 |
| `helm_secret_entries_vault_secret_id_key` | `vault_secret_id` (unique) | 16,384 |

A five-second-bounded read-only aggregate found 2 accounts, 2,746 records and
22 secret metadata rows. There were no `assistantActivityLog` rows. The
statistics estimates reported only 6 records and 0 secrets; they are not a
reliable cardinality or unused-index oracle for this review. No production
statistics reset, schema change or business-record export was performed.

### Query coverage

| Current query | Existing coverage and decision |
| --- | --- |
| `get_helm_account_snapshot_for_collections`: account equality, collection `ANY`, JSON aggregation ordered by collection/record ID, including tombstones | The record PK has the matching account/collection prefix and order; the active-only index cannot replace tombstone-inclusive coverage. State has its account PK; tiny tables can favor a sequential scan. |
| `get_helm_changed_collections`: account equality plus `account_version > since`, distinct collections | Existing account-version index supplies the selective version range. Broad gaps still have to read all qualifying rows. |
| Changed secret metadata: account equality, version range, `EXISTS` | An account-prefixed PK is available; the fixture cheaply scans the 22-row metadata table. No evidence justifies another version index. |
| Activity `fetchHelmCollectionPage`: account/collection equality, active rows, `created_at DESC, record_id ASC`, 51-row lookahead and offset | Existing indexes filter account/collection but do not provide timestamp order. Assess a narrow ordering index against actual volume before adding one. |
| Other collection pages: same filters, `position ASC NULLS LAST, record_id ASC` | Existing active-position index matches the ordered read. |
| `fetchAllHelmRecordRows` scoped fallback: account/collection filter, collection/record ID order, 1,000-row pages and exact count | Existing record PK covers the filter/order. Exact count still visits the matching entries; another identical prefix does not remove that work. |

### Bounded local plans and timings

Run [the opt-in synthetic SQL fixture](../scripts/benchmark-helm-query-indexes.sql)
using its documented local Docker command. It clones table shapes into
transaction-scoped temporary tables, loads invented values, analyzes only those
tables, and rolls back. It never copies account records or Vault values.

PostgreSQL 17.6; one warm-up and five measured executions per case. The fixture
contains 30,246 rows: two accounts with 1,373 records each and no Activity, plus
two hypothetical growth accounts with 2,500/25,000 records, including 500/5,000
Activity rows. There are 22 synthetic secret metadata rows. Distribution,
payload size and warm-cache state are synthetic, not a production workload
replica. These are SQL-body plans; they exclude RPC authentication/RLS,
PostgREST and network overhead. The final receipt is
`query-plan-measurements-final.jsonl` in the KAN-320 task artifacts.

| Baseline case | Observed plan / work | Median execution, ms |
| --- | --- | ---: |
| Scoped tasks | Record PK index scan, 686 rows, JSON aggregation | 3.852 |
| Scoped tasks + inventory | Record PK index scan, 1,373 rows, JSON aggregation | 7.841 |
| Scoped empty array | Record PK scan, 0 records | 0.012 |
| Changed collections, recent gap | Version index scan, 13 rows; distinct collection aggregate | 0.019 |
| Changed collections, full gap | Version bitmap index/heap scan, 1,373 rows | 0.251 |
| Changed collections, no gap | Version index scan, 0 records | 0.016 |
| Account version probe | Sequential scan of four fixture state rows | 0.004 |
| Activity empty | Active-position index scan, 0 rows; trivial sort | 0.007 |
| Generic position page | Active-position index scan, 51 rows; no sort | 0.015 |
| Scoped fallback first page | Record PK index scan, 1,000 rows; no sort | 0.173 |
| Scoped fallback exact count | Record PK index-only scan, 1,373 entries | 0.188 |

The changed-collection cases include secret `EXISTS`; its plan uses a sequential
scan of the tiny metadata table and stops on a match. No secret values are read.

One temporary candidate was compared:
`(user_id, created_at DESC, record_id)` where
`collection = 'assistantActivityLog' AND deleted_at IS NULL`. It removes the
Activity sort and allocates 344,064 bytes for 5,500 synthetic entries.

| Hypothetical Activity case | Existing indexes, ms | Candidate, ms | Candidate rows visited |
| --- | ---: | ---: | ---: |
| 500 rows, first 51 | 0.161 | 0.016 | 51 |
| 5,000 rows, first 51 | 5.289 | 0.014 | 51 |
| 5,000 rows, offset 2,500 | 5.628 | 0.327 | 2,551 |

Baseline growth plans filter 500/5,000 entries and sort; candidate plans use an
ordered index scan. Deep offsets still traverse skipped entries. An adopted
index would add an entry for each active Activity record and maintenance on
relevant writes; write latency was not benchmarked because the candidate is
not being adopted. No other index candidate is justified by these plans.

### Decision

Retain the deployed indexes; this change adds no migration or runtime query
change. Scoped reads already have account/collection coverage, version checks
have a version-range index, and a secret version index would add maintenance
for only 22 metadata rows. An Activity timestamp index would currently index
zero rows. A faster synthetic growth case alone is not evidence of a worthwhile
deployed benefit.

Revisit when observed Activity volume or slow-query evidence makes its sort
material, or when measured secret version scans become expensive. Capture fresh
cardinality and comparable plans before adding the narrowest useful index.
This review does not establish a production latency reduction, resolve the
earlier Disk IO incident, or prove general Supabase health.
