import { useEffect, useState } from 'react';
import { logError } from '../services/logger';
import { getQuranTranslation } from '../services/quranTranslation';
import type { QuranMotivationReference } from '../types/domain';

interface QuranTranslationState {
  reference: QuranMotivationReference;
  text?: string;
  error?: string;
}

export function useQuranTranslation(reference: QuranMotivationReference) {
  const [state, setState] = useState<QuranTranslationState | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getQuranTranslation(reference, controller.signal).then(text => {
      if (!controller.signal.aborted) setState({ reference, text });
    }).catch(error => {
      if (controller.signal.aborted) return;
      logError(`Quran.com translation ${reference}`, error);
      setState({ reference, error: 'English translation unavailable. Retry or read this passage on Quran.com.' });
    });
    return () => controller.abort();
  }, [reference, attempt]);

  // A previous day's response must never accompany the new day's Arabic.
  const current = state?.reference === reference ? state : null;
  return {
    text: current?.text,
    error: current?.error,
    retry: () => {
      setState(null);
      setAttempt(previous => previous + 1);
    },
  };
}
