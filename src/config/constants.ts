/**
 * Application-wide constants — no magic numbers in code.
 *
 * All timing values in milliseconds, all limits as plain numbers.
 */

// ── Timing (milliseconds) ──

export const TIMING = {
  /** Browser TTS fallback playback timeout */
  TTS_FALLBACK_TIMEOUT: 3000,
  /** Max recording duration before auto-stop */
  RECORDING_MAX_DURATION: 8000,
  /** End a voice turn early if no speech arrives at all. */
  VOICE_NO_SPEECH_TIMEOUT: 5000,
  /** Brief pause after Lina finishes speaking before reopening the mic. */
  VOICE_SESSION_RESUME_DELAY: 250,
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
  /** Google Calendar auto-sync throttle */
  SYNC_THROTTLE: 15 * 60 * 1000,
  /** Level-up flash animation duration */
  LEVEL_FLASH_DURATION: 1000,
} as const;

export const VOICE_SESSION = {
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

// ── API Timeouts (milliseconds) ──

export const API_TIMEOUT = {
  /** Google Calendar API calls */
  GOOGLE_CALENDAR: 10_000,
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
  /** Default calendar event duration (ms = 1 hour) */
  DEFAULT_EVENT_DURATION: 3600000,
} as const;

// ── Environment ──

export const LOCALHOST_HOSTNAMES = ['localhost', '127.0.0.1', '::1', '[::1]'] as const;
