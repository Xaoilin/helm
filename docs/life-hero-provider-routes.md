# Life Hero External Evidence Routes

KAN-263 froze the provider boundary for KAN-264 through KAN-268. KAN-264 implements only the GitHub row: a hosted Edge Function performs the read-only App exchange, keeps expiring credentials in Supabase Vault, and submits a bounded atomic evidence batch. The remaining routes stay contract-only. The executable mirror is `src/types/lifeHeroProviderRoutes.ts`; later tickets must preserve it or record a reviewed superseding decision.

All evidence was checked against first-party pages on 2026-08-30. A checked date proves the page was reviewed then, not that an undocumented API does or does not exist.

## Route matrix

| Provider | Approved route | Automation and user step | Authentication and secret boundary | Minimum retained provenance | Failure and safe fallback | Cost and prerequisites |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub | Hosted, read-only GitHub App for selected repositories; exactly `Metadata: read` and `Pull requests: read` | Automatic reads after explicit install/authorization; explicit reconnect after revocation or permission change | Enable user-to-server token expiration before token generation; only then does the hosted authorization-code exchange yield expiring user/refresh tokens. Tokens and app secret stay server-side in Supabase Vault | API version, repository ID, PR node ID, authorized user ID, merged instant, local date | 401 reconnect; 403/404 unavailable; 429 respect reset/retry-after; timeout/partial pagination awards nothing and retains bounded diagnostics. Existing progress stays unchanged | GitHub account, registered app, selected-repository installation, enabled user-to-server token expiration, hosted callback; provider fee is not stated in the cited docs |
| Barclays | User-selected official statement PDF; no direct bank connector | User signs in only at Barclays, downloads a statement, then explicitly selects it locally | Barclays session remains outside Sabah One; no bank credential, cookie, PIN, access code, or token is accepted | Parser-fixture version, statement digest, bounded account pseudonym, qualifying reason, local date | Encrypted, malformed, changed-format, ambiguous, or partial parse rejects the whole import. Existing manual Finance path remains available | Existing eligible account plus app/Online Banking. Direct automation needs a regulated Open Banking third party or selected intermediary; neither is approved |
| iPhone movement | User-selected Apple Health XML export | User exports from Health and explicitly selects the file | Health session remains on iPhone; no Apple credential or token | Health type, source/device label, stable source/date digest, local date | Malformed/oversized XML, unsupported types, ambiguous source/time zone, future dates, or partial parse rejects the whole import. Existing Move path remains authoritative | HealthKit is a known native API, but it is unavailable to Sabah One's hosted-web runtime; use the supported XML export route |
| Eight Sleep | User-requested official data export; parser blocked until a representative schema is verified | User requests a data copy in Eight Sleep, reviews it, and explicitly selects a supported file | Eight Sleep session remains outside Sabah One; no password, cookie, token, or unofficial endpoint | Versioned export fixture, stable session digest, completed local sleep date | Unknown/partial schema, partner ambiguity, or missing stable session identity imports nothing. Existing Health reflection remains available | Existing account and in-app Data Privacy request. Format, delivery time, charge, and public developer API are unknown |
| Elif B | Manual Sabah One completion confirmation | User confirms provider identity, completed session, and local date; no communications are inspected | No provider authentication or secret | Generated session identity, provider label, local date, qualifying reason | Missing/ambiguous identity or session creates no evidence. Existing Learn momentum remains available | Provider identity, official product/API/export, price, and prerequisites are unknown; no signup, purchase, contact, scraping, or login automation is authorized |

## Frozen evidence semantics

- GitHub: one `craft_practice` per authored pull request merged in an explicitly selected repository. Commits, lines changed, issue/comment volume, and popularity do not change XP. The trusted-integration tier is allowed only after the real hosted authorization and API boundary passes.
- Barclays: reuse only the existing `transfer_to_savings` or `avoidable_spend_improved` finance reasons. Statement presence, balances, income, amounts, and transaction volume do not award XP. A user-supplied file remains `self_reported` because Sabah One cannot verify its authenticity.
- iPhone movement: one `vitality_activity` per local date containing positive iPhone `stepCount` or `distanceWalkingRunning` evidence. Quantity does not change XP, and routes/location are never imported. The exported file remains `self_reported`.
- Eight Sleep: at most one `vitality_activity` per completed local sleep date after a representative official export schema is verified. Scores, duration, biometrics, snoring, temperature, and sample count do not change XP. Until the schema is proven, award nothing.
- Elif B: one `knowledge_learning` per explicitly confirmed session. Duration, lesson count, grades, and content do not change XP. The route remains `self_reported` until the provider identity and a supported authenticated or signed interface are known.

Every route uses the existing database-owned award rules, stable idempotency/source identity, and no-caller-XP RPC. Raw provider payloads, files, messages, code, financial details, health samples, credentials, and secrets are excluded from shared records, Life Hero metadata, logs, analytics, Broadcast, exports, assistant context, and durable memory.

## KAN-264 GitHub implementation

The `github-life-hero` hosted function is the only GitHub data boundary. It requires a signed-in Sabah One session, starts a state-bound App installation and user authorization flow, validates the GitHub account identity, refreshes expiring user-to-server credentials server-side, and never returns a token to the browser. Connection metadata contains only the GitHub user identity, selected repository IDs, API version, installation ID, and bounded sync status; the credential payload is held in Supabase Vault.

The user explicitly selects up to 25 repositories after installation. Sync reads closed pull requests page by page, validates the authorized-user match and non-null merged instant, converts the merged instant to the account app time zone, and submits all candidates in one bounded transaction. A candidate is one fixed `craft_practice` event identified by repository ID plus pull-request node ID. The database resolves XP from the existing `life-hero-v1` rules; commits, lines changed, comments, issue volume, titles, bodies, source code, and repository popularity never affect progression.

The UI labels unconfigured, signed-out, revoked/reconnect, forbidden/unavailable, rate-limited, empty-selection/no-qualifying-PR, partial-sync, and temporary-unavailable states. A provider or pagination failure is recorded as bounded diagnostic metadata and commits no candidates, so previous Life Hero progress remains unchanged. Replaying a completed sync returns duplicates through the existing stable source/idempotency protections without a second award.

## Later-ticket acceptance contract

Each owner ticket must prove the success path, duplicate replay, malformed/unknown input, authorization or identity mismatch, provider failure, redaction, and safe fallback described in the executable contract. A fixture or provider sandbox is evidence only for the boundary it exercises. The ticket must also add or explicitly block the narrow semantic agent interface required by `docs/agent-access.md` for a materially changed account-data feature.

No provider failure may delete or reduce existing Life Hero evidence. Unsupported or unavailable data stays visibly unavailable; it is never inferred from product usage, browser automation, scraping, unrelated account records, or another provider.

## Primary-source record

### Barclays

- Barclays, [Open Banking](https://www.barclays.co.uk/help/open-banking/what-is-open-banking/) — checked 2026-08-30; confirms sharing current-account information with FCA-approved providers.
- Barclays, [Print or save your online statement](https://www.barclays.co.uk/help/accounts/statements-balances/print-online-statements/) — checked 2026-08-30; confirms user-directed PDF statement download and its local-security warning.
- Open Banking Limited, [API Specifications v4.0.1](https://standards.openbanking.org.uk/api-specifications/latest/) — published 2026-03-18; checked 2026-08-30.
- Open Banking Limited, [Account provider enrolment and testing](https://www.openbanking.org.uk/account-providers/) — checked 2026-08-30; confirms regulated-directory and testing prerequisites. No intermediary is selected.

### Eight Sleep

- Eight Sleep, [What data does Eight Sleep collect? How is it stored and protected?](https://help.eightsleep.com/en_us/what-data-does-the-eight-sleep-tracker-collect-Hk79MjgUm) — published 2026-02-22; checked 2026-08-30; confirms collected data classes and the in-app data-copy request.
- Eight Sleep, [App Terms and Conditions](https://www.eightsleep.com/app-terms-conditions/) — checked 2026-08-30; confirms account/device data and user-directed third-party sharing, including Apple Health. It does not document a public developer API or export schema, so both remain unknown.

### iPhone movement

- Apple, [Share your data in Health on iPhone](https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/26/ios/26) — checked 2026-08-30; confirms user export of all health and fitness data as XML.
- Apple, [HealthKit](https://developer.apple.com/documentation/healthkit) and [authorizing access](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data) — checked 2026-08-30; confirms native app capability, per-type permission, and privacy behavior.
- Apple, [`distanceWalkingRunning`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/distancewalkingrunning) — checked 2026-08-30; confirms iPhone/Apple Watch movement samples and possible coalescing.

### GitHub

- GitHub, [Deciding when to build a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app) and [choosing permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app) — checked 2026-08-30; support fine-grained, selected-repository access and least-privilege permission selection.
- GitHub, [REST repository endpoints](https://docs.github.com/en/rest/repos/repos) — checked 2026-08-30; `GET /repos/{owner}/{repo}` requires `Metadata: read` for private resources.
- GitHub, [Generating a user access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) — checked 2026-08-30; documents the hosted web authorization-code exchange.
- GitHub, [Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens) — checked 2026-08-30; expiring user and refresh tokens are conditional on enabling the GitHub App user-to-server token expiration option.
- GitHub, [REST pull-request endpoints](https://docs.github.com/en/rest/pulls/pulls) — checked 2026-08-30; listing pull requests requires `Pull requests: read` for private resources.
- GitHub, [REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — checked 2026-08-30; documents 403/429 behavior and reset/retry handling.

### Elif B

No authoritative provider identity, official product page, API, export, authentication contract, price, or prerequisite was supplied or found on 2026-08-30. This is an explicit unknown, not evidence that no private capability exists. The approved boundary is manual confirmation with no external access.
