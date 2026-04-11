import { CLOCK } from '../config/constants';
import type { ClockTimerSound } from '../types/domain';

interface TimerSoundNote {
  atMs: number;
  durationMs: number;
  frequency: number;
  type?: OscillatorType;
  gain?: number;
}

interface TimerSoundDefinition {
  id: ClockTimerSound;
  label: string;
  description: string;
  notes: TimerSoundNote[];
}

const TIMER_SOUND_LIBRARY: Record<ClockTimerSound, TimerSoundDefinition> = {
  chime: {
    id: 'chime',
    label: 'Chime',
    description: 'Bright two-note chime.',
    notes: [
      { atMs: 0, durationMs: 260, frequency: 1046.5, type: 'triangle' },
      { atMs: 180, durationMs: 380, frequency: 1568, type: 'triangle' },
      { atMs: 620, durationMs: 260, frequency: 1046.5, type: 'triangle', gain: 0.03 },
      { atMs: 820, durationMs: 360, frequency: 1568, type: 'triangle', gain: 0.03 },
    ],
  },
  bell: {
    id: 'bell',
    label: 'Bell',
    description: 'Warm bell-style strikes.',
    notes: [
      { atMs: 0, durationMs: 420, frequency: 783.99, type: 'sine' },
      { atMs: 70, durationMs: 320, frequency: 1174.66, type: 'triangle', gain: 0.022 },
      { atMs: 560, durationMs: 420, frequency: 783.99, type: 'sine' },
      { atMs: 630, durationMs: 320, frequency: 1174.66, type: 'triangle', gain: 0.022 },
    ],
  },
  pulse: {
    id: 'pulse',
    label: 'Pulse',
    description: 'Focused repeating pulses.',
    notes: [
      { atMs: 0, durationMs: 140, frequency: 880, type: 'square', gain: 0.02 },
      { atMs: 220, durationMs: 140, frequency: 880, type: 'square', gain: 0.02 },
      { atMs: 440, durationMs: 140, frequency: 880, type: 'square', gain: 0.02 },
      { atMs: 720, durationMs: 240, frequency: 988, type: 'triangle', gain: 0.03 },
    ],
  },
  dawn: {
    id: 'dawn',
    label: 'Dawn',
    description: 'Gentle rising melody.',
    notes: [
      { atMs: 0, durationMs: 240, frequency: 523.25, type: 'sine', gain: 0.024 },
      { atMs: 220, durationMs: 260, frequency: 659.25, type: 'sine', gain: 0.026 },
      { atMs: 460, durationMs: 300, frequency: 783.99, type: 'triangle', gain: 0.03 },
      { atMs: 760, durationMs: 420, frequency: 1046.5, type: 'triangle', gain: 0.03 },
    ],
  },
};

export const TIMER_SOUND_OPTIONS = (CLOCK.TIMER_SOUNDS as readonly ClockTimerSound[]).map((id) => ({
  id,
  label: TIMER_SOUND_LIBRARY[id].label,
  description: TIMER_SOUND_LIBRARY[id].description,
}));

let activeAudioContext: AudioContext | null = null;
let activeOscillators: OscillatorNode[] = [];
let activeGains: GainNode[] = [];
let cleanupTimeout: number | null = null;

function getAudioContextConstructor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || (window as Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  }).webkitAudioContext || null;
}

async function getAudioContext(): Promise<AudioContext | null> {
  const AudioCtx = getAudioContextConstructor();
  if (!AudioCtx) return null;

  if (!activeAudioContext || activeAudioContext.state === 'closed') {
    activeAudioContext = new AudioCtx();
  }

  if (activeAudioContext.state === 'suspended') {
    await activeAudioContext.resume().catch(() => {});
  }

  return activeAudioContext;
}

function disconnectActiveNodes() {
  for (const oscillator of activeOscillators) {
    try {
      oscillator.onended = null;
      oscillator.stop();
    } catch {
      // Ignore nodes that have already stopped.
    }
    oscillator.disconnect();
  }

  for (const gain of activeGains) {
    gain.disconnect();
  }

  activeOscillators = [];
  activeGains = [];
}

export function stopTimerAlarm(): void {
  if (cleanupTimeout !== null) {
    window.clearTimeout(cleanupTimeout);
    cleanupTimeout = null;
  }

  disconnectActiveNodes();
}

function scheduleNote(
  audioContext: AudioContext,
  startAt: number,
  note: TimerSoundNote,
) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  const noteStart = startAt + note.atMs / 1000;
  const noteEnd = noteStart + note.durationMs / 1000;
  const attackSeconds = Math.min(note.durationMs / 2000, CLOCK.ALARM_ATTACK_MS / 1000);
  const releaseSeconds = Math.min(note.durationMs / 1000, CLOCK.ALARM_RELEASE_MS / 1000);
  const peakGain = note.gain ?? CLOCK.ALARM_GAIN;

  oscillator.type = note.type ?? 'triangle';
  oscillator.frequency.setValueAtTime(note.frequency, noteStart);

  gainNode.gain.setValueAtTime(0.0001, noteStart);
  gainNode.gain.linearRampToValueAtTime(peakGain, noteStart + attackSeconds);
  gainNode.gain.linearRampToValueAtTime(0.0001, Math.max(noteStart + attackSeconds, noteEnd - releaseSeconds));
  gainNode.gain.setValueAtTime(0.0001, noteEnd);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.start(noteStart);
  oscillator.stop(noteEnd);

  activeOscillators.push(oscillator);
  activeGains.push(gainNode);
}

function getTimerSound(sound: ClockTimerSound): TimerSoundDefinition {
  return TIMER_SOUND_LIBRARY[sound] ?? TIMER_SOUND_LIBRARY[CLOCK.DEFAULT_TIMER_SOUND];
}

export async function primeTimerAlarmAudio(): Promise<void> {
  await getAudioContext();
}

export async function playTimerAlarm(sound: ClockTimerSound): Promise<boolean> {
  const audioContext = await getAudioContext();
  if (!audioContext) return false;

  stopTimerAlarm();

  const definition = getTimerSound(sound);
  const startAt = audioContext.currentTime + 0.02;
  let totalDurationMs = 0;

  for (const note of definition.notes) {
    scheduleNote(audioContext, startAt, note);
    totalDurationMs = Math.max(totalDurationMs, note.atMs + note.durationMs);
  }

  cleanupTimeout = window.setTimeout(() => {
    cleanupTimeout = null;
    disconnectActiveNodes();
  }, totalDurationMs + CLOCK.ALARM_SETTLE_MS);

  return true;
}
