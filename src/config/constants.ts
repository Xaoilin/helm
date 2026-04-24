/**
 * Application-wide constants — no magic numbers in code.
 *
 * All timing values in milliseconds, all limits as plain numbers.
 */

// ── Timing (milliseconds) ──

export const TIMING = {
  /** Stopwatch and timer repaint cadence */
  CLOCK_TICK: 100,
  /** Browser TTS fallback playback timeout */
  TTS_FALLBACK_TIMEOUT: 3000,
  /** Last-resort cap on a single spoken turn if no reliable boundary arrives. */
  VOICE_TURN_MAX_DURATION: 45000,
  /** End a voice turn early if no speech arrives at all. */
  VOICE_NO_SPEECH_TIMEOUT: 5000,
  /** Brief pause after Lina finishes speaking before reopening the mic. */
  VOICE_SESSION_RESUME_DELAY: 250,
  /** Short settle window after Deepgram signals an utterance boundary. */
  VOICE_TURN_END_SETTLE_DELAY: 500,
  /** Deepgram live endpointing silence window. */
  DEEPGRAM_ENDPOINTING: 300,
  /** Deepgram live utterance-end silence window. */
  DEEPGRAM_UTTERANCE_END_MS: 2500,
  /** Duration of Lina's mic-ready earcon. */
  VOICE_READY_TONE_DURATION: 140,
  /** Fade-in/out used to keep the earcon soft. */
  VOICE_READY_TONE_FADE: 24,
  /** Wake word detection cooldown between triggers */
  WAKE_WORD_COOLDOWN: 2000,
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
  /** MediaRecorder chunk collection interval */
  CHUNK_INTERVAL: 250,
  /** Grace period before forcing a live Deepgram socket closed */
  DEEPGRAM_LIVE_CLOSE_GRACE: 250,
  /** Chrome SpeechRecognition test timeout */
  CHROME_STT_TIMEOUT: 5000,
  /** Chrome SpeechRecognition abort delay after start */
  CHROME_STT_ABORT_DELAY: 1500,
  /** Google token expiry safety buffer (request refresh 60s early) */
  TOKEN_EXPIRY_BUFFER: 60000,
  /** Supabase write queue debounce */
  SUPABASE_DEBOUNCE: 1000,
  /** Delay before scrolling a task revealed by Lina into view */
  ASSISTANT_TASK_REVEAL_SCROLL_DELAY: 80,
  /** How long a Lina-revealed task stays highlighted */
  ASSISTANT_TASK_REVEAL_HIGHLIGHT: 3000,
  /** Ollama connection test timeout */
  OLLAMA_CONNECTION_TIMEOUT: 3000,
  /** Ollama model list fetch timeout */
  OLLAMA_MODEL_LIST_TIMEOUT: 5000,
  /** Ollama availability cache expiry */
  OLLAMA_CACHE_EXPIRY: 60000,
  /** Ollama unavailable cooldown after failure */
  OLLAMA_UNAVAILABLE_COOLDOWN: 30000,
  /** Hosted assistant availability cache expiry */
  HOSTED_ASSISTANT_CACHE_EXPIRY: 60000,
  /** Hosted assistant unavailable cooldown after failure */
  HOSTED_ASSISTANT_UNAVAILABLE_COOLDOWN: 30000,
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

export const VOICE_SESSION = {
  CONVERSATION_TITLE: 'Voice conversation',
  READY_TONE: {
    FREQUENCY: 880,
    GAIN: 0.025,
    TYPE: 'triangle',
  },
  GREETING: {
    en: 'Hey, how can I help?',
    ar: 'مرحباً، كيف أقدر أساعدك؟',
  },
  STOP_RESPONSE: {
    en: "Okay, I'll stop listening.",
    ar: 'حسناً، سأتوقف عن الاستماع.',
  },
  STOP_PHRASES: {
    en: [
      'stop',
      'cancel',
      'thats all',
      "that's all",
      'that is all',
      'thanks lina',
      'thank you lina',
      'bye lina',
      'goodbye lina',
    ],
    ar: [
      'توقفي',
      'إيقاف',
      'خلاص',
      'يكفي',
      'شكراً لينا',
      'شكرا لينا',
      'مع السلامة لينا',
    ],
  },
} as const;

export const CHAT = {
  DEFAULT_CONVERSATION_TITLE: 'New conversation',
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
  /** Monzo bank API calls */
  MONZO: 10_000,
  /** Deepgram speech-to-text transcription */
  DEEPGRAM_STT: 15_000,
  /** Deepgram live transcript preview connection */
  DEEPGRAM_LIVE_CONNECT: 5_000,
  /** Ollama LLM chat completion */
  OLLAMA_CHAT: 30_000,
  /** Hosted assistant chat completion via Supabase Edge Function */
  HOSTED_ASSISTANT_CHAT: 30_000,
  /** Hosted assistant billing summary via Supabase Edge Function */
  HOSTED_ASSISTANT_BILLING: 30_000,
  /** ElevenLabs text-to-speech */
  ELEVENLABS_TTS: 10_000,
  /** AlAdhan prayer times API */
  PRAYER_TIMES: 10_000,
} as const;

// ── Limits ──

export const LIMITS = {
  /** Google Calendar max events per page */
  CALENDAR_MAX_EVENTS: 250,
  /** Ollama LLM temperature (creativity) */
  LLM_TEMPERATURE: 0.7,
  /** Ollama LLM max response tokens */
  LLM_MAX_TOKENS: 300,
  /** Monzo transactions per fetch */
  MONZO_TRANSACTION_LIMIT: 100,
  /** Monzo transaction history window (days) */
  MONZO_HISTORY_DAYS: 90,
  /** Calendar sync: past days to fetch */
  CALENDAR_PAST_DAYS: 30,
  /** Calendar sync: future days to fetch */
  CALENDAR_FUTURE_DAYS: 60,
  /** Min audio blob size to consider as speech (bytes) */
  MIN_AUDIO_BLOB_SIZE: 500,
  /** LLM conversation history messages to keep */
  LLM_HISTORY_MESSAGES: 10,
  /** Persist up to this many assistant transcript corrections */
  ASSISTANT_CORRECTION_MEMORY: 100,
  /** Persist up to this many Google Calendar diagnostic timeline entries */
  GOOGLE_CALENDAR_DIAGNOSTIC_EVENTS: 250,
  /** Persist up to this many Lina assistant activity log entries */
  ASSISTANT_ACTIVITY_LOG: 250,
  /** Default calendar event duration (ms = 1 hour) */
  DEFAULT_EVENT_DURATION: 3600000,
  /** Dashboard focus candidate pool before GPT chooses among them */
  DASHBOARD_FOCUS_CANDIDATE_POOL: 8,
  /** Dashboard focus queue length shown on the dashboard */
  DASHBOARD_FOCUS_QUEUE: 3,
  /** Dashboard focus feedback retention window in days */
  DASHBOARD_FOCUS_FEEDBACK_DAYS: 30,
} as const;

export const ASSISTANT_BENCHMARK = {
  /** Minimum overall corpus pass rate required for the release gate. */
  MIN_OVERALL_PASS_RATE: 0.98,
  /** Destructive intents must never regress below a perfect pass rate. */
  MIN_DESTRUCTIVE_PASS_RATE: 1,
  /** Unsupported-action no-approximation cases must never regress below a perfect pass rate. */
  MIN_UNSUPPORTED_PASS_RATE: 1,
  /** Number of failing cases to show inline before summarising the remainder. */
  MAX_FAILURES_IN_SUMMARY: 12,
} as const;

export const STORAGE_KEYS = {
  /** Keep the last open shell surface when the browser reloads. */
  SHELL_SURFACE: 'helm:shell-surface',
} as const;

// ── Environment ──

export const LOCALHOST_HOSTNAMES = ['localhost', '127.0.0.1', '::1', '[::1]'] as const;
