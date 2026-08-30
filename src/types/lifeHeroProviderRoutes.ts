import type { LifeHeroProviderRouteContract } from './domain';

const CHECKED_AT = '2026-08-30';

/**
 * KAN-263 freezes later-ticket boundaries without implementing a connector.
 * The string detail is deliberate: it is reviewable policy, not executable
 * provider behavior. Later tickets must preserve or explicitly supersede it.
 */
export const LIFE_HERO_PROVIDER_ROUTE_CONTRACTS = [
  {
    provider: 'barclays',
    ownerTicket: 'KAN-265',
    capabilityStatus: 'regulated_automation_not_selected',
    route: 'barclays_statement_import',
    automation: 'user_assisted_import',
    evidenceKind: 'financial_progress',
    sourceTier: 'self_reported',
    authenticationBoundary: 'provider_session_outside_sabah_one',
    secretBoundary: 'no_provider_secret',
    userAssistedSteps: [
      'Sign in to Barclays directly, outside Sabah One.',
      'Download a statement from Barclays and explicitly choose it for import.',
    ],
    acceptedInput: 'A locally selected Barclays statement PDF matching a versioned parser fixture.',
    qualifyingRule: 'Reuse the existing transfer-to-savings or avoidable-spend-improved rule; balances, income, statement presence, and transaction volume never award XP.',
    dataMinimisation: [
      'Parse the selected file ephemerally and never persist or upload the raw statement.',
      'Retain only the stable statement digest, bounded account pseudonym, qualifying reason, and local date.',
      'Never place merchant text, balances, amounts, account numbers, or sort codes in Life Hero metadata.',
    ],
    provenance: [
      'Provider-labelled statement fixture version.',
      'Stable digest plus provider/account/date identity for duplicate suppression.',
    ],
    failureBehavior: 'Reject unsupported, encrypted, malformed, ambiguous, or partially parsed statements atomically; create no award or finance mutation.',
    safeFallback: 'Leave current account-backed Finance and Life Hero progress unchanged and direct the user to the existing manual finance path.',
    costAndPrerequisites: [
      'Requires an existing eligible Barclays account and Barclays app or Online Banking access.',
      'No additional statement-download charge is stated by Barclays.',
      'Direct automation would require a regulated Open Banking third party or selected intermediary; no intermediary, commercial contract, or production onboarding is approved.',
    ],
    requiredTests: [
      'Representative redacted statement fixture accepts only the existing qualifying finance reasons.',
      'Duplicate import returns the original evidence identity without a second award.',
      'Malformed, encrypted, changed-format, and partial files fail closed without persisting raw data.',
      'Sensitive finance fields are absent from records, diagnostics, logs, and Life Hero metadata.',
    ],
    primarySources: [
      {
        owner: 'Barclays',
        title: 'Open Banking',
        url: 'https://www.barclays.co.uk/help/open-banking/what-is-open-banking/',
        checkedAt: CHECKED_AT,
      },
      {
        owner: 'Barclays',
        title: 'Print or save your online statement',
        url: 'https://www.barclays.co.uk/help/accounts/statements-balances/print-online-statements/',
        checkedAt: CHECKED_AT,
      },
      {
        owner: 'Open Banking Limited',
        title: 'API Specifications v4.0.1',
        url: 'https://standards.openbanking.org.uk/api-specifications/latest/',
        sourceDate: '2026-03-18',
        checkedAt: CHECKED_AT,
      },
      {
        owner: 'Open Banking Limited',
        title: 'Account providers: enrolment and testing prerequisites',
        url: 'https://www.openbanking.org.uk/account-providers/',
        checkedAt: CHECKED_AT,
      },
    ],
  },
  {
    provider: 'eight_sleep',
    ownerTicket: 'KAN-267',
    capabilityStatus: 'user_export_supported_api_unknown',
    route: 'eight_sleep_data_export_import',
    automation: 'user_assisted_import',
    evidenceKind: 'vitality_activity',
    sourceTier: 'self_reported',
    authenticationBoundary: 'provider_session_outside_sabah_one',
    secretBoundary: 'no_provider_secret',
    userAssistedSteps: [
      'Request a copy of Eight Sleep data from Menu, Help and Support, Data Privacy.',
      'Review the delivered archive and explicitly select a supported export file for import.',
    ],
    acceptedInput: 'Only a representative Eight Sleep export format whose schema and provenance fields have been fixture-verified; the current schema is unknown.',
    qualifyingRule: 'At most one vitality_activity per completed local sleep date; score, duration, biometric magnitude, snoring, temperature, and number of samples never change XP.',
    dataMinimisation: [
      'Parse the selected export ephemerally and never retain the raw archive or biometric samples.',
      'Retain only provider, stable session identity digest, completed local sleep date, and qualifying reason.',
      'Never retain heart rate, HRV, respiratory rate, snoring, temperature, raw movement, sleep-stage detail, or partner data in Life Hero metadata.',
    ],
    provenance: [
      'Versioned representative export fixture and bounded provider/session digest.',
      'Explicit self_reported tier because a user-supplied archive is not cryptographically verified by Sabah One.',
    ],
    failureBehavior: 'Until a representative official export is validated, or whenever its schema is unknown or partial, import nothing and award nothing.',
    safeFallback: 'Keep existing Health reflection and Life Hero progress unchanged; allow the user to record their ordinary self-reported routine through existing Sabah One paths.',
    costAndPrerequisites: [
      'Requires an existing Eight Sleep account and access to its in-app Data Privacy request.',
      'The official help page states that a data copy can be requested; format, delivery time, and any charge are not documented and remain unknown.',
      'No current official public developer API documentation was located on 2026-08-30; no unofficial endpoint may be used.',
    ],
    requiredTests: [
      'A representative, redacted official export fixture is mandatory before parser implementation.',
      'Unknown schema, missing session identity, partner ambiguity, and partial export fail closed.',
      'Duplicate sessions do not create duplicate evidence or awards.',
      'Biometrics, raw payloads, credentials, and partner data never enter storage, logs, analytics, Broadcast, or assistant context.',
    ],
    primarySources: [
      {
        owner: 'Eight Sleep',
        title: 'What data does Eight Sleep collect? How is it stored and protected?',
        url: 'https://help.eightsleep.com/en_us/what-data-does-the-eight-sleep-tracker-collect-Hk79MjgUm',
        sourceDate: '2026-02-22',
        checkedAt: CHECKED_AT,
      },
      {
        owner: 'Eight Sleep',
        title: 'App Terms and Conditions',
        url: 'https://www.eightsleep.com/app-terms-conditions/',
        checkedAt: CHECKED_AT,
      },
    ],
  },
  {
    provider: 'elif_b',
    ownerTicket: 'KAN-268',
    capabilityStatus: 'provider_identity_unknown',
    route: 'elif_b_manual_confirmation',
    automation: 'manual_confirmation',
    evidenceKind: 'knowledge_learning',
    sourceTier: 'self_reported',
    authenticationBoundary: 'no_provider_authentication',
    secretBoundary: 'no_provider_secret',
    userAssistedSteps: [
      'Confirm one completed learning session and its local date inside Sabah One.',
      'Do not paste messages, credentials, contact details, lesson content, or private correspondence.',
    ],
    acceptedInput: 'A Sabah One-owned manual completion record after the user confirms the provider identity and completed session.',
    qualifyingRule: 'At most one knowledge_learning event per confirmed session identity; session duration, lesson count, grades, and content never change XP.',
    dataMinimisation: [
      'Retain a generated session identity, local date, provider label, and qualifying reason only.',
      'Never retain private messages, lesson content, contact details, recordings, screenshots, or another person\'s account data.',
    ],
    provenance: [
      'Sabah One manual confirmation receipt.',
      'Explicit self_reported tier until an identified provider supplies a supported signed or authenticated interface.',
    ],
    failureBehavior: 'If the provider identity, session, or local date is ambiguous, create no evidence, award nothing, and explain what must be confirmed.',
    safeFallback: 'Reuse the existing Learn momentum path; do not create an Elif B-specific integration or infer activity from communications.',
    costAndPrerequisites: [
      'Provider identity, official product, API, export, authentication, price, and prerequisites are unknown as of 2026-08-30.',
      'No signup, purchase, contact, scraping, login automation, or credential entry is authorized.',
    ],
    requiredTests: [
      'Missing provider identity, session identity, or local date fails closed.',
      'Duplicate manual confirmation returns the original evidence identity.',
      'Private content and contact-like fields are rejected from metadata.',
      'No test fixture or copy invents an API, URL, price, or provider capability.',
    ],
    primarySources: [],
  },
  {
    provider: 'iphone_movement',
    ownerTicket: 'KAN-266',
    capabilityStatus: 'user_export_supported_api_unknown',
    route: 'apple_health_xml_import',
    automation: 'user_assisted_import',
    evidenceKind: 'vitality_activity',
    sourceTier: 'self_reported',
    authenticationBoundary: 'provider_session_outside_sabah_one',
    secretBoundary: 'no_provider_secret',
    userAssistedSteps: [
      'Use the iPhone Health app to export all health and fitness data as XML.',
      'Explicitly select the export for local Sabah One import.',
    ],
    acceptedInput: 'Apple Health export XML containing stepCount or distanceWalkingRunning records from a selected iPhone Health source.',
    qualifyingRule: 'At most one vitality_activity per local date with positive iPhone movement; distance, step magnitude, workout intensity, and number of samples never change XP.',
    dataMinimisation: [
      'Parse locally and discard the raw export after the bounded import session.',
      'Aggregate only a daily movement-present boolean and stable source/date digest.',
      'Never retain routes, coordinates, heart data, medical records, workouts, contacts, or unrelated Health categories.',
    ],
    provenance: [
      'Apple Health export type, source/device label, local date, and stable source/date digest.',
      'Explicit self_reported tier because an exported XML file can be modified outside Sabah One.',
    ],
    failureBehavior: 'Reject malformed XML, unsupported types, ambiguous source/time zone, future dates, and partial parses atomically; award nothing.',
    safeFallback: 'Keep the existing Sabah One Move progression and Life Hero reconciliation unchanged.',
    costAndPrerequisites: [
      'Requires an iPhone with Health data and a manual Health export.',
      'Apple documents HealthKit as an app capability, not a browser API; direct HealthKit access is outside the hosted-web runtime.',
      'No additional export charge is documented; storage space and user time are prerequisites.',
    ],
    requiredTests: [
      'Representative redacted Health XML accepts only stepCount and distanceWalkingRunning.',
      'Time-zone boundary samples aggregate to the correct local date.',
      'Duplicate records and repeated imports create at most one source/date evidence identity.',
      'Malformed XML, billion-laughs/entity expansion, oversized files, and mixed sensitive categories fail safely without retention.',
    ],
    primarySources: [
      {
        owner: 'Apple',
        title: 'Share your data in Health on iPhone',
        url: 'https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/26/ios/26',
        checkedAt: CHECKED_AT,
      },
      {
        owner: 'Apple',
        title: 'HealthKit',
        url: 'https://developer.apple.com/documentation/healthkit',
        checkedAt: CHECKED_AT,
      },
      {
        owner: 'Apple',
        title: 'Authorizing access to health data',
        url: 'https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data',
        checkedAt: CHECKED_AT,
      },
      {
        owner: 'Apple',
        title: 'distanceWalkingRunning',
        url: 'https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/distancewalkingrunning',
        checkedAt: CHECKED_AT,
      },
    ],
  },
  {
    provider: 'github',
    ownerTicket: 'KAN-264',
    capabilityStatus: 'supported_read_only',
    route: 'github_app_read_only',
    automation: 'read_only_automatic',
    evidenceKind: 'craft_practice',
    sourceTier: 'trusted_integration',
    authenticationBoundary: 'provider_authorization_server_exchange',
    secretBoundary: 'supabase_vault_server_only',
    userAssistedSteps: [
      'Install and authorize the Sabah One GitHub App for explicitly selected repositories.',
      'Reconnect explicitly after revocation, expiry, or a permission change.',
    ],
    acceptedInput: 'GitHub REST responses fetched by a hosted Edge Function using expiring GitHub App user access and refresh tokens held in Supabase Vault.',
    qualifyingRule: 'At most one craft_practice per pull request authored by the authorized user and merged in an explicitly selected repository; commits, lines changed, comments, issue volume, and repository popularity never change XP.',
    dataMinimisation: [
      'Request only Metadata read, Contents read, and Pull requests read for selected repositories.',
      'Retain stable repository and pull-request identities, author match, merged instant, local date, and qualifying reason.',
      'Never retain source code, diffs, commit messages, branch names, PR titles/bodies, comments, emails, or repository secrets in Life Hero metadata.',
    ],
    provenance: [
      'GitHub API version, repository ID, pull-request node ID, authorized user ID, and merged instant.',
      'Stable provider identity supplies duplicate suppression without exposing private repository names.',
    ],
    failureBehavior: '401 or revoked authorization requires explicit reconnect; 403 or 404 is unavailable/insufficient access; 429 waits for the documented reset or retry-after boundary; every failure creates no award and preserves diagnostics without secrets.',
    safeFallback: 'Keep the integration disconnected or stale-labelled and leave existing Life Hero progress unchanged; never synthesize GitHub activity.',
    costAndPrerequisites: [
      'Requires a GitHub account, a registered Sabah One GitHub App, selected-repository installation, and a hosted Edge Function callback.',
      'GitHub documents API rate limits; provider pricing for this specific use is not stated in the cited documentation and remains unknown.',
    ],
    requiredTests: [
      'Authorization callback, selected-repository scope, token refresh, revocation, and account mismatch fail closed.',
      'Only authored merged pull requests qualify; open, closed-unmerged, foreign-authored, and duplicate PRs do not.',
      '403, 404, 429, malformed response, timeout, and partial pagination preserve prior evidence and create no guessed award.',
      'No token, code, private repository text, or raw API payload enters browser storage, shared records, logs, analytics, Broadcast, exports, or assistant context.',
    ],
    primarySources: [
      {
        owner: 'GitHub',
        title: 'Deciding when to build a GitHub App',
        url: 'https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app',
        checkedAt: CHECKED_AT,
      },
      {
        owner: 'GitHub',
        title: 'Choosing permissions for a GitHub App',
        url: 'https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app',
        checkedAt: CHECKED_AT,
      },
      {
        owner: 'GitHub',
        title: 'Generating a user access token for a GitHub App',
        url: 'https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app',
        checkedAt: CHECKED_AT,
      },
      {
        owner: 'GitHub',
        title: 'REST API endpoints for pull requests',
        url: 'https://docs.github.com/en/rest/pulls/pulls',
        checkedAt: CHECKED_AT,
      },
      {
        owner: 'GitHub',
        title: 'Rate limits for the REST API',
        url: 'https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api',
        checkedAt: CHECKED_AT,
      },
    ],
  },
] as const satisfies readonly LifeHeroProviderRouteContract[];
