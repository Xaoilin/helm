# Availability Operations

## Objective and evidence boundary

Sabah One targets at least 99.5% successful completed public probe runs over a rolling 30-day window. A run succeeds only when the protected `master` version matches the public Pages release, the current app entry asset responds, Supabase Auth health responds, and the public operational collector is enabled at schema 1 with the exact protected source SHA.

The workflow runs every 15 minutes. The operational detection objective is therefore 15 minutes plus any GitHub scheduler or queue delay; it is an objective, not an SLA. Track scheduler gaps separately from failed probes. The practical active-page recovery objective is at most 45 seconds once the backend is healthy. Current assembled-browser evidence does not isolate that production wall-clock interval: its retained `recoveryMs` is 42,663 ms from incident to recovery and includes an intentional 10-second outage plus a 31-second fake-clock advance after restore. It proves the recovery state and timing instrumentation under synthetic services, not attainment of a live recovery objective.

The monitor uses public endpoints and a Supabase public key only. It has no user session, does not write product telemetry, and retains no response bodies, URLs, headers, personal data, or credentials. Every request has an eight-second deadline and a bounded response. The job has a five-minute ceiling, writes a bounded JSON artifact for seven days, updates the GitHub step summary, and exits nonzero on any failed assertion. GitHub's native run status is the only notification path.

## Probes and release identity

`.github/workflows/availability-monitor.yml` checks out protected `master` for every scheduled or manual run. `scripts/monitor-availability.mjs` then checks:

| Probe | Pass condition |
| --- | --- |
| Pages release | `release.json` has a valid version equal to the checked-out `package.json` version. |
| Pages app | The served HTML names a same-origin JavaScript asset and that exact asset answers the bounded `HEAD` request. |
| Supabase Auth | `/auth/v1/health` responds successfully with the configured public key and no user bearer token. |
| Operational collector | Public `GET /functions/v1/operational-events` returns `ok: true`, `enabled: true`, schema 1, and a release SHA equal to the checked-out protected commit. |

Pages currently exposes exact version but not commit SHA, so the workflow does not claim commit identity for the web bundle. The collector exposes its exact deployed SHA. A version or SHA mismatch is actionable and fails the run, including during a legitimate rollout; the artifact records expected and observed identities rather than claiming web/function parity prematurely.

## Failed and recovered runs

Open the failed **Availability Monitor** run and read its step summary first. Download `availability-monitor-<run>-<attempt>` only when the summary is insufficient. Use the probe code, HTTP status, expected identity, observed identity, and correlation UUID; the artifact intentionally contains no raw response or remote error text.

After the underlying deployment or provider incident is resolved, manually dispatch the workflow with `synthetic_fault=none`. Recovery is established by a later healthy run; a rerun does not rewrite the failed evidence.

The controlled fault exercise uses `synthetic_fault=expected_version_mismatch`. It reads the actual public release version, supplies a deliberately different expected version to the real comparison, and must finish failed with `pages-release: version_mismatch`. A following `none` dispatch must pass to demonstrate recovery. Do not create a production outage for this exercise.

## Bounded investigation

- **Auth:** Inspect only the `supabase-auth` probe first. Re-run the public health request with an eight-second limit and the configured public-key environment variable; never add a user token. If it still fails, inspect Auth and gateway entries in Supabase Dashboard Unified Logs and current provider status.
- **Realtime:** The synthetic does not open a private Realtime channel. For an app incident, filter retained operational events by `"domain":"realtime"` and the exact correlation ID, then distinguish `channel_error`, heartbeat timeout, browser offline, and recovery before changing retry behavior.
- **Network:** When Pages, Auth, and collector fail together, check DNS/TLS and provider status before changing product code. When only one probe fails, constrain investigation to that origin. Repeat once after the reported provider recovery; do not create an unbounded retry loop.
- **Provider:** Filter by the affected domain and `rate_limited`, `server_error`, or `timeout`. Confirm the provider's current status and one bounded direct request. Paid assistant availability is outside this public monitor and must not be inferred from it.
- **Reload/version:** Compare the artifact's expected and observed version first. For app reports, inspect `release` events for `release_available`, `reload_suppressed`, or `client_update_required`. Avoid repeated forced reloads; verify the public manifest and its named asset once after deployment settles.

For the collector-health synthetic, take the artifact correlation UUID and filter Supabase request logs (`function_edge_logs`) by the exact path fragment `operational-events/availability-<uuid>`. For retained product telemetry, select custom function console logs (`function_logs`) in Supabase Dashboard Logs and use the exact quoted JSON fragment `"correlationId":"<uuid>"`; then add `"domain":"<domain>"` if needed. Request rows do not prove custom console-event retention. Because the workflow has no user session, its UUID is not POSTed as a product event.

Telemetry delivery is independent of product success. The real browser client kept confirmed task writes usable while the synthetic collector returned 503, then reported recovery; its diagnostics export contained the bounded event schema without business payloads. The same assembled check covered 390, 768, and 1440 pixel widths with keyboard and scroll interaction.

Browser queues, deadlines, retries, and collector limits are bounded. Immediate reload sends only the newest 10 events with a three-second keepalive deadline and remains best effort; it does not guarantee offline delivery. Network errors, timeouts, 429, and 5xx responses retry at most three times. Permanent 400, 401, 403, 422, and invalid-receipt failures drop without retry. Independent asynchronous requests use unique correlations; only explicit lifecycle streams keep one correlation through recovery. A collection failure must not block the underlying user operation. The collector writes structured custom console events to Supabase retained logs and creates no account-data table.

Custom collection requires a valid first-party session. Events produced while signed out or unable to authenticate can remain local only; account changes clear that local history and queued events. Use platform Auth/gateway logs for server-side authentication denials. Neither this queue nor the export is a persistent offline audit trail.

## Investigation findings

Controlled failures distinguish Realtime subscription and heartbeat loss, browser lifecycle changes, authentication denial/refresh, database read/write errors, provider 503 responses, and release checks. The browser exercise retained confirmed data and completed a task write during a Realtime failure and a separate collector outage. Focused checks cover payload exclusion, account switches, permanent collection errors, and unrelated concurrent requests without falsely declaring recovery.

Two avoidable interruption paths were corrected: core snapshot, paged-record, and account-version reads now carry a ten-second native request abort deadline, and release reloads defer while the page is hidden/disposed or contains pending writes, an open modal, or visible editable text. The manifest request has a five-second deadline. Deferral leaves the one-reload marker available for the next safe check; reload diagnostics use a bounded best-effort keepalive send.

The predecessor's synthetic anonymous assistant request was read back as retained platform event `ebf36b37-d2b3-451e-9145-6a87f7cd96ea`: HTTP 503, 5,408 ms, `EDGE_FUNCTION_ERROR`, at 2026-09-21 22:33:47 GMT. Its duration is consistent with the existing five-second Auth lookup deadline, but a bounded search found no matching custom warning and the original response body is unavailable. The exact Auth/network/response cause remains unknown. This synthetic request does not identify the user's historical disconnect trigger, which remains unverified.

## Rollback and limits

Sol owns protected rollback and live acceptance. Preserve the failed run, exact source SHA, and deployment identity; Sol can promote the last known-good candidate or a reviewed revert through the existing protected receipt path. Re-run the healthy monitor and verify the exact Pages version and collector SHA before calling rollback complete.

These synthetics do not prove signed-in reads or writes, private account isolation, database correctness, Realtime delivery, paid providers, browser recovery timing, or automatic failover. They also do not establish infrastructure redundancy.

## Current infrastructure evidence

The 2026-09-22 read-only assessment found the Supabase project `ACTIVE_HEALTHY` in `eu-north-1` (Stockholm) on the Free plan with shared NANO compute, up to 0.5 GB memory, and an 8 GB disk. The database used 47.62 MB against the displayed 0.5 GB Free database-size limit. This is a dated health and capacity observation, not an availability guarantee.

There are no development branches or read replicas; all reads and writes use the primary. There are no hosted scheduled backups and PITR is not enabled. Recovery behavior, a recoverable backup artifact, restore success, RPO, and RTO remain unproved. The deploy gate checks only that `HELM_DATABASE_BACKUP_SHA256` has a 64-hex shape; it does not validate a backup artifact, age, off-site availability, or restore rehearsal.

For the 2026-08-29 to 2026-09-29 billing period, the dashboard showed 1.75 GB uncached egress of 5 GB, 0.001 GB cached egress of 5 GB, 26,207 Edge Function invocations of 500,000, 5,968 Realtime messages of 2,000,000, and a peak of 8 Realtime connections of 200. Values may lag by up to one hour.

Provider bounds relevant to the collector are 10,000 characters per log event and 100 log events per 10 seconds. Exact retained-log duration was not verified, so the operation does not depend on a claimed retention period. The collector's smaller application limits remain per-isolate controls and are not global quotas.

Confirmed early platform evidence: an unauthenticated `OPTIONS` request to the existing Employment MCP returned 204, and Supabase Dashboard Unified Logs retained/read back the exact correlation path as Edge Function event `42075eab-4064-4e71-a7cc-f12ea83a2e23`. This proves the existing route-to-log observation path only. The Management API `logs.all` removal notice is effective 2026-09-23; this runbook uses Dashboard Unified Logs and does not script that removed API.

Each release requires Sol to retain custom `sabah-one/operational-event/v1` readback from the deployed `operational-events` function and verify final Pages/collector source identity. Keep those exact event IDs and deployment receipts with the release evidence. No redundancy, failover, backup restore, RPO, or RTO evidence is currently available; do not claim it.
