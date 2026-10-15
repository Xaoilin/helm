# Daily egress budget — KAN-332

Status: **Measuring**. This change prepares collection and checking; it does not
prove a deployed 24-hour result. Sol owns release, measurement and final Jira
acceptance. There is no background collector or new account-data interface.

The budget is **120,000,000 uncached bytes per complete 24 hours** (decimal
120 MB, about 3.6 GB per 30 days). It applies to the original organization
`xwvpzlbyhlbdmtdmtdbn`, **all projects and all services**, including Sabah One
`aeiijptebzenjhgcntup`. Do not narrow the dropdown to only one project or omit
shared-pooler traffic. A low average across several days cannot hide an
over-budget day. This measures post-fix use; historical billed usage remains.

## Supported provider route and current gap

The documented read route is the signed-in [organization Usage page](https://supabase.com/dashboard/org/xwvpzlbyhlbdmtdmtdbn/usage#egress).
[Supabase's egress guide](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
documents the all-project default, period selector and service breakdown.
**Total Egress includes cached traffic**; retain exact matching cached bytes
and subtract them once. Database API and shared-pooler egress are separate
provider categories; do not double-count the database-to-pooler leg. All seven
categories must be covered: Database, Auth, Storage, Functions, Realtime,
Shared Pooler and Log Drains, even if a category is explicitly zero.

No supported raw billing API or CLI command has been established for this
ticket. The documented dashboard route is verified in official documentation;
its **current authenticated raw-byte precision, timezone, completeness watermark
and export capability are unverified**. Sol controls that browser session and
must establish those properties before marking a reading complete. Do not
invent an endpoint, a CLI flag or a fixed provider timezone. An official
[2024 usage-delay announcement](https://supabase.com/changelog/28480-improved-invoices-and-more-timely-usage-data)
describes a gradual reduction in reporting delay; it does not prove this
organization's current watermark. A later collection time alone does not
prove finality. If only rounded MB/GB tooltips or partial dates are available,
retain their sanitized source and leave `precision` unknown/rounded,
`dataThrough` null, and status Measuring. This is a provider-capability gap,
not zero traffic and not a reason to contact support or purchase a plan.

The frozen 14 October daily artifact is a historical UI excerpt with truncated
labels and `NaNundefined`; it cannot supply exact bytes, missing zeros or
complete post-release periods. Query counters, TCP header bytes and short
extrapolations are diagnostics only. Edge logs do not provide response bytes
according to the egress guide, so they cannot replace the provider reading.

## Release and start protocol (Sol)

1. Use normal ready CI/protected promotion for the exact HELM candidate. Retain
   exact commits, trees, CI/Pages/function deployment runs and live identity
   receipts for HELM and services. Accepted starting versions were HELM
   `d886206b113d8f8ea3c653115b0b903e61533eb5` / 0.2.219 and services
   `e0b65fb6fcf43b62e41d0a1d1064b61d30dfb33c`; replace the HELM identity with
   the actual KAN-332 release. Never inherit a different tree's gate.
2. Retain the three blocking hosted business receipts (Employment, Finance,
   Equity). Each must confirm deletion of its own OAuth client, Auth deletion
   plus independent 404, and post-delete Prayer readback with both worker flags
   disabled. Keep `scripts/lib/hosted-fixture-cleanup.ts` and all 156 shared
   fixtures unchanged. Retained business history is allowed. Freeze this
   release/cleanup receipt, hash it and record both completion timestamps.
3. Before the observation, establish the provider's raw-byte and window shape
   through the route above. Record a sanitized baseline with the organization,
   all-project filter, service coverage, exact period boundaries including
   timezone/UTC offset, collection time and provider data-through time. If only
   daily buckets exist, select the first **full provider day after** final
   deployment and cleanup. Do not count the release day or start an observation
   on an unreleased branch. Normalize verified boundaries to explicit UTC
   instants; no local-date guesses, clock advancement or weekly shortcut.
4. Predeclare at least one continuous 24-hour window. Keep signed-in Windows
   and Mac HELM tabs open throughout, preserve ordinary reminders/metrics and
   normal agent use. Record start/end coverage and any gaps without account
   identities or content. Keep timestamped evidence of ordinary reminder
   delivery, approved/revoked MCP access and Calendar cross-device convergence.
   Use published semantic domain tools for business operations. Any deliberate
   synthetic acceptance fixture must be owned and fully cleaned up through the
   existing guard before the window (or restart the window after cleanup).
   Never edit a human's business data to manufacture workload or acceptance.
5. After the window, wait for a provider watermark covering its exact end, then
   read the same complete window and scope. Retain **all results**, including
   failures, as a new sanitized evidence file. A date label and collection
   timestamp alone do not establish a 24-hour bucket. Confirm units from the
   current provider surface; never convert a rounded display back into bytes.
   Include actual source total and cached integer byte values. If a component
   is missing, ambiguous or NaN, mark coverage incomplete; do not invent zero.

## Collect a sanitized receipt and check it

Copy [the deliberately incomplete example](egress-reading.example.json) into a
new KAN-332 evidence directory outside Git, then fill it only from verified
provider/release/workload evidence. The example's dates are illustrations,
not a booked observation. Change `kind` to `provider` only for a real reading;
set `precision: exact-bytes` and `complete: true` only after verifying them.
`dataThrough` is the provider's coverage watermark, not the browser clock.
`evidenceSha256` fields are SHA-256 of independently retained, sanitized source
files (provider, release/cleanup, workload). Use `shasum -a 256 <file>` and keep
a local manifest mapping each hash to its file. The checker validates shape
and arithmetic; **Sol must read back those files and verify hashes, provenance,
exact release identities and factual attestations** before accepting it.

From the repository root, with Node dependencies installed:

```sh
node scripts/check-egress-budget.mjs --input /absolute/evidence/reading.json --output /absolute/evidence/budget-result-1.json
```

`--config /absolute/budget.json` selects another strict config with
`organizationRef` and `dailyBudgetBytes`. The committed config defaults to
120,000,000 bytes. A tighter limit is supported; a higher setting never relaxes
KAN-332's independent 120 MB ceiling. A budget increase requires an evidence-
backed user decision. Each bucket must be exactly 86,400 elapsed seconds;
multiple buckets must be adjacent, ordered and individually within budget.
For provider days with another duration, leave Measuring and obtain a supported
24-hour window rather than relabeling or normalizing partial data.

The tool has no network/auth/database/browser path. It writes a strict
sanitized report to a **new** file (exclusive create), hashes the input, and
rejects unknown fields without echoing them. It accepts no free text, URLs,
SQL, query IDs, account IDs, packet contents, token values or business records.
Never feed raw dashboard network archives, full logs or transcripts into it.
Do not commit operational readings or evidence to the public repository.

| Exit | Result | Meaning |
| --- | --- | --- |
| 0 | `within-budget` | Complete provider bytes and claimed prerequisite evidence pass the arithmetic; controller readback still required. |
| 1 | `over-budget` / `invalid` | Retain failure; investigate measured residual traffic or correct the invalid reading using source evidence. |
| 2 | `measuring` | Precision, scope, duration, watermark, release/cleanup or workload evidence is incomplete. Never mark Done. |

Optional `diagnostics` accepts paired aggregate calls/rows for the seven domain
services and their statistics-reset instants. Obtain these only from existing
authorized aggregate diagnostics. No resets, business reads or query text.
Changed reset timestamps or decreasing counters yield null deltas; even valid
deltas do not affect the byte budget. Keep the same timestamped diagnostic
window and label any mismatch. No new service instrumentation is required.

## Final readback, failure and rollback

Sol retains the provider before/after source, input and output hashes, both
exact deployments, teardown proof, representative-use evidence and fresh Jira
dependency graph. Validate the receipt again from the saved input to a new
output path, compare the numeric result and link that receipt on KAN-332.
Only actual continuous deployed usage plus passing behavior and independent
evidence readback can complete the ticket. The tool never sets Jira Done.

If any complete day exceeds 120 MB, retain the failed receipt, identify concrete
remaining traffic using bounded aggregate diagnostics, and leave In Review.
Do not drop metrics/security/checks, slow reminders, raise the budget, discard
an inconvenient sample or invent a whole-bill reduction percentage. If provider
access is restricted, record that boundary and leave Measuring. The existing
ignore-continuity decision authorizes no paid plan or human messages.

This change only adds offline tools/docs and bumps release metadata. Roll back
through the normal protected repository/Sol route if needed; no schema,
account-data mutation, service rollback or runtime policy change is introduced.
