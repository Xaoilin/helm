# Private Product Usage Analytics

KAN-259 adds an account-owned, first-party event history for understanding how Sabah One is used. It does not add the Activity viewer or product recommendations; those remain KAN-269.

## Captured taxonomy

Each signed-in browser session can record six typed event kinds: session, navigation, action, outcome, error, and performance. Events carry stable product keys plus bounded operational dimensions: surface, target, outcome, duration, error code, release, device class, input kind, online state, reduced-motion preference, sequence, and timestamps.

The initial production instrumentation records session start, application readiness, surface views, time spent on each surface, desktop and mobile navigation selections, sign-out, and recoverable surface render failures. Future features use the same service rather than sending arbitrary payloads.

## Privacy boundary

Analytics is private and owner-only. It is active only for signed-in Sabah One sessions and is stored by the Sabah One profile service under the authenticated account. It is not ad analytics or cross-site tracking.

The browser accepts only stable snake-case taxonomy keys. Optional metadata has a five-key allowlist and scalar values only. The database repeats these constraints and rejects unsupported top-level fields. Tokens, secrets, credentials, prayer details, learning content, exact finance values, balances, transaction descriptions, names, emails, locations, notes, and provider payloads have no accepted field.

The historical `settings.telemetry` value remains readable for compatibility, but no external anonymous telemetry sender exists and it does not control this private account history. The Settings surface now describes the actual private behaviour without adding a pause control, matching the approved product decision.

## Reliability and ownership

Since the Phase 3 migration the profile service owns this history (`activity` schema). The browser queue posts at most 25 events per batch to `POST /api/profile/v1/activity/events`, with an `Idempotency-Key` derived from the batch's event IDs; event IDs and session sequence numbers make retries idempotent (a repeat is a duplicate, never an error). A failed analytics batch is retained within a bounded in-memory queue and never blocks navigation, authentication, or another primary action.

The Activity page reads `GET /api/profile/v1/activity/insights` for its filters; the service computes the summary, trends, funnel, coded errors, recommendations and cold start, and the browser only displays them.

Supabase's `product_usage_events` is read-only history (owner-only read RLS, no writes). Its `ingest_product_usage_events(jsonb)` RPC was dropped by migration `20260927090000_retire_product_usage_ingest.sql` after the profile service copied the table once.
