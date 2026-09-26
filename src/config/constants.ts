/**
 * Application-wide constants — no magic numbers in code.
 *
 * All timing values in milliseconds, all limits as plain numbers.
 */

// ── Timing (milliseconds) ──

export const TIMING = {
  /** Stopwatch and timer repaint cadence */
  CLOCK_TICK: 100,
  /** Dashboard prayer countdown tick interval */
  DASHBOARD_TICK: 1000,
  /** Adhan notification check interval */
  ADHAN_CHECK_INTERVAL: 30000,
  /** Toast notification display duration */
  TOAST_LIFETIME: 3000,
  /** Delay before focusing text input */
  INPUT_FOCUS_DELAY: 50,
  /** Auth state initial load debounce */
  AUTH_LOAD_DEBOUNCE: 500,
  /** How often the web app checks for a newer deployed release */
  RELEASE_POLL_INTERVAL: 60000,
  /** Google token expiry safety buffer (request refresh 60s early) */
  TOKEN_EXPIRY_BUFFER: 60000,
  /** Supabase write queue debounce */
  SUPABASE_DEBOUNCE: 1000,
  /** How often the daily task rollover checks whether the app day has changed */
  DAILY_ROLLOVER_CHECK_MS: 60000,
  /** Dashboard focus expiry cap before a refresh is allowed */
  DASHBOARD_FOCUS_CACHE_TTL: 15 * 60 * 1000,
  /** Default dashboard focus snooze window */
  DASHBOARD_FOCUS_SNOOZE: 60 * 60 * 1000,
  /** Dashboard focus clock tick for time-sensitive recommendations */
  DASHBOARD_FOCUS_TICK: 60 * 1000,
  /** Google Calendar auto-sync throttle */
  SYNC_THROTTLE: 15 * 60 * 1000,
  /** Level-up flash animation duration */
  LEVEL_FLASH_DURATION: 1000,
} as const;

export const CLOCK = {
  DEFAULT_TIMER_DURATION_MS: 5 * 60 * 1000,
  MIN_TIMER_DURATION_MS: 1000,
  MAX_TIMER_DURATION_MS: 24 * 60 * 60 * 1000,
  MAX_LABEL_LENGTH: 40,
  MAX_STOPWATCH_LAPS: 20,
  DEFAULT_TIMER_SOUND: 'chime',
  TIMER_SOUNDS: ['chime', 'bell', 'pulse', 'dawn'] as const,
  ALARM_GAIN: 0.045,
  ALARM_ATTACK_MS: 24,
  ALARM_RELEASE_MS: 170,
  ALARM_SETTLE_MS: 240,
  PRESET_MINUTES: [1, 5, 15, 25] as const,
} as const;

export const HEALTH_FAST_FOOD = {
  MAX_VENUE_LENGTH: 60,
  MAX_ORDER_LENGTH: 80,
  MAX_NOTES_LENGTH: 240,
  RATINGS: [
    { value: 'good', label: 'Felt fine', emoji: '\u{1F642}' },
    { value: 'mixed', label: 'Mixed', emoji: '\u{1F610}' },
    { value: 'bad', label: 'Bad', emoji: '\u{1F615}' },
    { value: 'awful', label: 'Awful', emoji: '\u{1F922}' },
  ] as const,
  SYMPTOMS: [
    { value: 'nauseous', label: 'Nauseous' },
    { value: 'bloated', label: 'Bloated' },
    { value: 'sluggish', label: 'Sluggish' },
    { value: 'headache', label: 'Headache' },
    { value: 'thirsty', label: 'Thirsty' },
    { value: 'brain-fog', label: 'Brain fog' },
    { value: 'cravings', label: 'Cravings' },
    { value: 'fine', label: 'Actually fine' },
  ] as const,
} as const;

export const TRIP_BUDGET = {
  DEFAULT_CURRENCY: 'GBP',
  CATEGORIES: [
    { value: 'transport', label: 'Transport', icon: '\u{1F6EB}' },
    { value: 'food', label: 'Food', icon: '\u{1F37D}\uFE0F' },
    { value: 'events', label: 'Events', icon: '\u{1F39F}\uFE0F' },
    { value: 'rent', label: 'Rent / Stay', icon: '\u{1F3E8}' },
    { value: 'shopping', label: 'Shopping', icon: '\u{1F6CD}\uFE0F' },
    { value: 'fees', label: 'Fees', icon: '\u{1F9FE}' },
    { value: 'other', label: 'Other', icon: '\u{1F4DD}' },
  ] as const,
  STATUSES: [
    { value: 'planned', label: 'Planned' },
    { value: 'paid', label: 'Paid' },
  ] as const,
} as const;

// ── API Timeouts (milliseconds) ──

export const API_TIMEOUT = {
  /** Google Calendar API calls */
  GOOGLE_CALENDAR: 10_000,
  /** Supabase Edge Function used for Google Calendar OAuth and token refresh */
  GOOGLE_CALENDAR_OAUTH: 15_000,
  /** AlAdhan prayer times API */
  PRAYER_TIMES: 10_000,
  /** Spring Boot prayer-service health check */
  PRAYER_BACKEND_HEALTH: 5_000,
  /** Signed-in data calls to the Spring Boot prayer and profile services */
  SERVICE_API: 10_000,
  /** Calendar writes that go through Google first; the service answers within 12 seconds */
  CALENDAR_WRITE: 15_000,
  /** Mirroring every connected Google calendar */
  CALENDAR_SYNC: 60_000,
} as const;

// ── Service resilience ──

/**
 * How calls to the Sabah One services back off when a service is briefly unavailable (network
 * failure, timeout, 429, 502, 503, 504). Reads always retry; writes retry only with an
 * Idempotency-Key, which the services apply once.
 */
export const SERVICE_RETRY = {
  /** Retries after the first attempt. */
  MAX_RETRIES: 3,
  /** Ceiling of the first wait; it doubles per retry (full jitter below it). */
  BASE_DELAY_MS: 500,
  MAX_DELAY_MS: 8_000,
  /** No retry starts after this long since the call began. */
  BUDGET_MS: 20_000,
  /** Consecutive failed attempts that make every call to that endpoint fail fast... */
  BREAKER_FAILURES: 5,
  /** ...for this long, after which one attempt is let through to test it. */
  BREAKER_COOLDOWN_MS: 30_000,
} as const;

// ── Limits ──

export const LIMITS = {
  /** Google Calendar max events per page */
  CALENDAR_MAX_EVENTS: 250,
  /** Calendar sync: past days to fetch */
  CALENDAR_PAST_DAYS: 30,
  /** Calendar sync: future days to fetch */
  CALENDAR_FUTURE_DAYS: 60,
  /** Persist up to this many Google Calendar diagnostic timeline entries */
  GOOGLE_CALENDAR_DIAGNOSTIC_EVENTS: 250,
  /** Default calendar event duration (ms = 1 hour) */
  DEFAULT_EVENT_DURATION: 3600000,
  /** Dashboard focus candidate pool before GPT chooses among them */
  DASHBOARD_FOCUS_CANDIDATE_POOL: 8,
  /** Dashboard focus queue length shown on the dashboard */
  DASHBOARD_FOCUS_QUEUE: 3,
  /** Dashboard focus feedback retention window in days */
  DASHBOARD_FOCUS_FEEDBACK_DAYS: 30,
} as const;

export const STORAGE_KEYS = {
  /** Keep the last open shell surface when the browser reloads. */
  SHELL_SURFACE: 'helm:shell-surface',
} as const;

export const PRAYER_REMINDERS = {
  DEFAULT_MINUTES: 15,
  OPTIONS_MINUTES: [5, 10, 15, 30] as const,
  SNOOZE_MINUTES: 5,
  SNOOZE_CUTOFF_MINUTES: 5,
  RUNTIME_TICK_MS: 15_000,
  TEST_DELAY_MS: 5_000,
  TEST_DEADLINE_MS: 60_000,
} as const;

// ── Environment ──

export const LOCALHOST_HOSTNAMES = ['localhost', '127.0.0.1', '::1', '[::1]'] as const;
