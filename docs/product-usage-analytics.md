# Private Product Usage Analytics

KAN-259 adds an account-owned, first-party event history for understanding how Sabah One is used. It does not add the Activity viewer or product recommendations; those remain KAN-269.

## Captured taxonomy

Each signed-in browser session can record six typed event kinds: session, navigation, action, outcome, error, and performance. Events carry stable product keys plus bounded operational dimensions: surface, target, outcome, duration, error code, release, device class, input kind, online state, reduced-motion preference, sequence, and timestamps.

The initial production instrumentation records session start, application readiness, surface views, time spent on each surface, desktop and mobile navigation selections, sign-out, and recoverable surface render failures. Future features use the same service rather than sending arbitrary payloads.

## Privacy boundary

Analytics is private and owner-only. It is active only for signed-in Sabah One sessions and is stored in Supabase under the authenticated account. It is not ad analytics or cross-site tracking.

The browser accepts only stable snake-case taxonomy keys. Optional metadata has a five-key allowlist and scalar values only. The database repeats these constraints and rejects unsupported top-level fields. Chat or assistant content, tokens, secrets, credentials, prayer details, learning content, exact finance values, balances, transaction descriptions, names, emails, locations, notes, and provider payloads have no accepted field.

The historical `settings.telemetry` value remains readable for compatibility, but no external anonymous telemetry sender exists and it does not control this private account history. The Settings surface now describes the actual private behaviour without adding a pause control, matching the approved product decision.

## Reliability and ownership

The browser queue batches at most 25 events per RPC. Event IDs and session sequence numbers make retries idempotent. A failed analytics batch is retained within a bounded in-memory queue and never blocks navigation, authentication, or another primary action.

`product_usage_events` has owner-only read RLS. Authenticated browsers cannot write the table directly; the bounded `ingest_product_usage_events(jsonb)` security-definer RPC derives ownership from `auth.uid()`. Anonymous access is denied. The non-destructive rollback revokes ingest permission while preserving event history.

## Life Hero separation

Product events have no foreign key, trigger, evidence rule, or API path into Life Hero evidence or awards. Real-world evidence remains the only way to gain Life Hero XP.
