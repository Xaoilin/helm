# Prayer challenge

Requested by Sabah on 4 November 2026 for both Lina One and Sabah One.

The dashboard compares prayer completion for a calendar month (default), Monday–Sunday week, or day. Previous periods are browsable. Scores count on-time plus late prayers divided by on-time, late and missed prayers. Pending, unclassified, pre-tracking and non-obligatory prayers are excluded by the existing prayer statistics service. Exact fractions decide the leader; rounded percentages are display only. An empty denominator has no score or winner.

The card refreshes on confirmed prayer changes, once per minute while mounted, and through Refresh. Account/session changes and superseded requests cannot reuse another account or period’s response. No totals or credentials are persisted in the browser. A missing partner is shown as unavailable, never as a zero score.

## Narrow sharing boundary

The two products keep separate Auth, databases, services and deployment identities. This requested comparison introduces only an explicitly configured, read-only exchange of period totals. The summary contains `from`, `to`, `asOf`, `onTime`, `late`, and `missed`. It contains no account IDs, individual prayer records, cycle dates, exemption counts, notes, location or other account data. Totals can still reveal patterns; pairing requires explicit owner activation.

- `GET /api/prayer/v1/competition?from=YYYY-MM-DD&to=YYYY-MM-DD` uses this product’s signed-in account. Only the configured owner receives the configured partner. Other accounts see their own totals and `not_connected`. OAuth client tokens are refused until a prayer agent contract is delivered.
- `GET /api/prayer/v1/competition/summary` uses a separate server-only `X-Prayer-Competition-Key`, scoped to the configured owner and this one read-only route. It cannot authorize ordinary prayer reads or writes. Requests without the exact key are rejected before database access.
- Both responses use `Cache-Control: no-store`. Ranges are bounded to 31 days. Peer reads have 2-second connection and 3-second response limits, refuse redirects, and validate matching dates, recent timestamps and bounded counts. Failures preserve the owner’s totals and show an unavailable partner.
- Shared fixtures `competition.json`, `competition-summary.json` and `competition-not-connected.json` are checked by provider integration tests and consumer runtime schemas. Synthetic browser tests cover period navigation, keyboard operation, responsive designs, ties, empty scores and failures.

## Activation and rollback

Implemented code is disabled until a reviewed pair is configured. No credentials are created or account pairing activated by the source change. After final owner approval, configure each product’s existing root-owned prayer environment independently:

| Environment variable | Value |
| --- | --- |
| `APP_PRAYER_COMPETITION_OWNER_ID` | Verified UUID of this product’s intended account |
| `APP_PRAYER_COMPETITION_READ_KEY` | New independent random secret, at least 32 characters; permits only this summary |
| `APP_PRAYER_COMPETITION_PEER_URL` | Approved partner HTTPS URL ending exactly in `/api/prayer/v1/competition/summary` |
| `APP_PRAYER_COMPETITION_PEER_KEY` | Partner’s dedicated summary key; never an Auth, database or application credential |

Use the existing root-only prayer environment file and product-specific restart path. Do not include values in repositories, web builds, CLI output, traces, exports or memory. The Lina repository does not configure Sabah resources; each deployment operator supplies only its own reviewed competition configuration. Account mapping must be established through an authorized identity route; there is no direct database or prayer-record lookup fallback for agents.

Remove the read key and restart that product’s prayer service to revoke inbound sharing. Remove its peer settings to stop outbound reads. Account records and prayer outcomes remain untouched.

## Acceptance boundary

Source and synthetic checks prove the feature only within their exercised boundaries. Real pairing and live account comparison remain pending explicit activation. A narrow `prayer_get_competition` semantic MCP tool is not yet published; external-agent acceptance is explicitly blocked. Agents must not inspect real prayer accounts through lower-level APIs, database access, session-token reuse or browser automation.
