import { API_TIMEOUT } from '../config/constants';
import type { AssistantLang } from './assistantTypes';

export async function speakWithElevenLabs(
  text: string,
  apiKey: string,
  voiceId: string,
): Promise<HTMLAudioElement> {
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    signal: AbortSignal.timeout(API_TIMEOUT.ELEVENLABS_TTS),
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_flash_v2_5',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`ElevenLabs API error: ${resp.status} ${resp.statusText}`);
  }

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  return new Audio(url);
}

export function speakWithBrowserTTS(text: string, lang: AssistantLang = 'en'): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.1;
    utterance.lang = lang === 'ar' ? 'ar-SA' : 'en-GB';
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();

    const voices = speechSynthesis.getVoices();
    if (lang === 'ar') {
      const arabicVoice = voices.find(voice => voice.lang.startsWith('ar'));
      if (arabicVoice) utterance.voice = arabicVoice;
    } else {
      const femaleVoice = voices.find(voice =>
        voice.name.includes('Female') || voice.name.includes('Zira') || voice.name.includes('Hazel')
      );
      if (femaleVoice) utterance.voice = femaleVoice;
    }

    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  });
}
