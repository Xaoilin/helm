# Prayer challenge

Requested by Sabah on 4 November 2026 for both Lina One and Sabah One.

The dashboard compares earned prayer points for a calendar month (default), Monday–Sunday week, or day. Previous periods are browsable. Each prayer earns 12 points within 15 minutes of the adhan, 8 within the time window, or 2 outside it. Historical untimed completed prayers retain 12-point credit. Higher earned points lead and equal earned points tie when both participants have eligible prayers. The card separately shows available points and prayers completed.

Each prayer joins the eligible total when its recording window opens. Dhuhr opens both Dhuhr and Asr; Maghrib opens both Maghrib and Isha. Open, unrecorded prayers are pending and earn zero points. Future, unclassified, pre-tracking and non-obligatory prayers are excluded. The card refreshes on confirmed prayer changes, at each wall-clock minute while mounted, on return from a later minute, and through Refresh. Account/session changes and superseded requests cannot reuse another account or period’s response. No totals or credentials are persisted in the browser. A missing partner is shown as unavailable, never as a zero score.

## Win record

Requested on 5 November 2026, starting **1 November 2026**. The current period's
progress remains separate from the Sabah–Lina win tally. Day counts completed
days in the displayed month, with no results before the start. Week counts
completed Monday–Sunday weeks beginning on or after the start; the partial week
containing 1 November is excluded. Month counts completed calendar months from
November onward. A current day can count immediately when both participants have completed every required prayer. A current week or month can count early only on its last date and only when both whole periods are complete; future dates never settle early.
Ties and periods without eligible scores are shown separately. The tally uses the same earned-points rule as current progress, including when displaying past results.

The browser derives this record from the existing authenticated totals-only
comparisons, with at most three reads in flight.
Completed results load on entering a record window, calendar-day rollover or
explicit Refresh, not on each minute's progress update. Changing accounts or
views discards superseded results and stops scheduling their remaining reads.
A failed or missing historical comparison hides the whole tally rather than
showing a partial result as complete. Refresh retries it.

## Narrow sharing boundary

The two products keep separate Auth, databases, services and deployment identities. This requested comparison introduces only an explicitly configured, read-only exchange of period totals. The summary contains `from`, `to`, `asOf`, `onTime`, `late`, `missed`, paired optional `pointsEarned`/`pointsAvailable`, optional `allPrayed`, and optional `pending`. The latter counts only open unrecorded prayer windows. The wire `pointsAvailable` field still covers classified outcomes. Each browser adds 12 points of capacity per pending prayer. It contains no account IDs, individual prayer records, cycle dates, exemption counts, notes, location or other account data. Totals can still reveal patterns; pairing requires explicit owner activation.

- `GET /api/prayer/v1/competition?from=YYYY-MM-DD&to=YYYY-MM-DD` uses this product’s signed-in account. Only the configured owner receives the configured partner. Other accounts see their own totals and `not_connected`. OAuth client tokens are refused until a prayer agent contract is delivered.
- `GET /api/prayer/v1/competition/summary` uses a separate server-only `X-Prayer-Competition-Key`, scoped to the configured owner and this one read-only route. It cannot authorize ordinary prayer reads or writes. Requests without the exact key are rejected before database access.
- Both responses use `Cache-Control: no-store`. Ranges are bounded to 31 days. Peer reads have 2-second connection and 3-second response limits, refuse redirects, and validate matching dates, recent timestamps and bounded counts. Failures preserve the owner’s totals and show an unavailable partner.
- Shared fixtures, including `competition-unlocked.json` and `competition-summary-unlocked.json`, are checked by provider integration tests and consumer runtime schemas. Synthetic browser tests cover period navigation, keyboard operation, responsive designs, ties, empty scores and failures.

## Sabah One and Lina One parity

Changes to shared prayer challenge scoring, eligibility, win records or card behavior require matching changes and regression coverage in both products. Keep the unlocked competition and summary fixtures byte-identical across both browsers and the Sabah One provider. Test both participant orderings and exercise the prayer-opening update in Firefox. Run both products’ contract and release checks before shipping a shared change. Keep product credentials, locations, records and deployments independent.

## Activation and rollback

Sharing is disabled by default. On 4 November 2026, Sabah explicitly approved completion-percentage scoring and creation of dedicated totals-only sharing credentials. The selected Sabah Google account and Lina account are now paired in their own server configurations. Independent keys remain in each product’s root-only prayer environment; no Auth or database credentials were shared. Only the prayer containers were restarted, and both products’ public prayer and database health checks passed.

The running-container checks confirmed that each environment matches its prepared private configuration. Each product’s peer key reached the other product’s invalid-range guard with HTTP 400; a wrong key and use of the peer key on ordinary prayer-outcome routes returned HTTP 401. Every check used an invalid or oversized range and read no prayer records or totals. This proves the authenticated link and its access boundary, rather than an actual account-total comparison.

The existing root-owned prayer environment supplies these settings independently for each product:

| Environment variable | Value |
| --- | --- |
| `APP_PRAYER_COMPETITION_OWNER_ID` | Verified UUID of this product’s intended account |
| `APP_PRAYER_COMPETITION_READ_KEY` | New independent random secret, at least 32 characters; permits only this summary |
| `APP_PRAYER_COMPETITION_PEER_URL` | Approved partner HTTPS URL ending exactly in `/api/prayer/v1/competition/summary` |
| `APP_PRAYER_COMPETITION_PEER_KEY` | Partner’s dedicated summary key; never an Auth, database or application credential |

Use the existing root-only prayer environment file and product-specific restart path. Do not include values in repositories, web builds, CLI output, traces, exports or memory. The Lina repository does not configure Sabah resources; each deployment operator supplies only its own reviewed competition configuration. Account mapping must be established through an authorized identity route; there is no direct database or prayer-record lookup fallback for agents.

Remove the read key and restart that product’s prayer service to revoke inbound sharing. Remove its peer settings to stop outbound reads. Account records and prayer outcomes remain untouched.

## Acceptance boundary

The approved pair is enabled. Source and synthetic checks cover the dashboard behavior; running-container checks cover the authenticated link, denied capabilities and service health. The actual signed-in prayer-total comparison has not been inspected by an agent. A narrow `prayer_get_competition` semantic MCP tool is not yet published; external-agent acceptance, including historical win records, remains explicitly blocked. Agents must not inspect real prayer accounts through lower-level APIs, database access, session-token reuse or browser automation.

## Explicit timing choices

The completion dialog offers Within 15 minutes of the adhan (12), Within time (8), and Outside time (2)
with one tap; no time entry is required. These are self-reported choices and are
never inferred from when a user logs the prayer. History can correct timing
without earning XP again. Outcome timing is service-confirmed and survives reload.
The challenge keeps confirmed values and card elements in place during refresh,
and replaces them only when the next same-account response arrives.

Both point summaries are required before a weighted comparison. During a mixed
backend rollout the card explains that point totals are updating, with no winner.
Existing fully legacy comparisons keep their completion meaning. The additive
backend must be deployed before this consumer. All external-agent Prayer MCP
limitations described above remain in force.

Prompt means within 15 minutes of the adhan. This remains self-reported: the app does not infer the prayer time from when an entry is logged. The same timing weights apply in both products.
