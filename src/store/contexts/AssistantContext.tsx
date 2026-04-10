import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import { LIMITS } from '../../config/constants';
import type { AssistantCorrection, AssistantCorrectionScope } from '../../types/domain';
import { loadStore, saveStore } from '../persistence';

export interface AssistantContextValue {
  corrections: AssistantCorrection[];
  loaded: boolean;
  upsertCorrection: (correction: {
    sourceText: string;
    targetText: string;
    lang: AssistantCorrection['lang'];
    scope: AssistantCorrectionScope;
  }) => string | null;
  noteCorrectionApplied: (id: string) => void;
}

const AssistantCtx = createContext<AssistantContextValue | null>(null);

function normaliseCorrectionKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function useAssistantContext(): AssistantContextValue {
  const ctx = useContext(AssistantCtx);
  if (!ctx) throw new Error('useAssistantContext must be used within AssistantProvider');
  return ctx;
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [corrections, setCorrections] = useState<AssistantCorrection[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const data = await loadStore<AssistantCorrection[]>('assistantCorrections');
      setCorrections(data ?? []);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (loaded) {
      void saveStore('assistantCorrections', corrections);
    }
  }, [corrections, loaded]);

  const upsertCorrection = useCallback((correction: {
    sourceText: string;
    targetText: string;
    lang: AssistantCorrection['lang'];
    scope: AssistantCorrectionScope;
  }): string | null => {
    const sourceText = correction.sourceText.trim().replace(/\s+/g, ' ');
    const targetText = correction.targetText.trim().replace(/\s+/g, ' ');
    if (!sourceText || !targetText) return null;
    if (normaliseCorrectionKey(sourceText) === normaliseCorrectionKey(targetText)) return null;

    const now = new Date().toISOString();
    const existingKey = `${correction.lang}:${correction.scope}:${normaliseCorrectionKey(sourceText)}`;
    let updatedId: string | null = null;

    setCorrections(prev => {
      const existing = prev.find(entry =>
        `${entry.lang}:${entry.scope}:${normaliseCorrectionKey(entry.sourceText)}` === existingKey,
      );

      if (existing) {
        updatedId = existing.id;
        return prev.map(entry =>
          entry.id === existing.id
            ? {
                ...entry,
                targetText,
                updatedAt: now,
              }
            : entry,
        );
      }

      const id = uuid();
      updatedId = id;
      const next: AssistantCorrection = {
        id,
        sourceText,
        targetText,
        lang: correction.lang,
        scope: correction.scope,
        appliedCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      return [next, ...prev].slice(0, LIMITS.ASSISTANT_CORRECTION_MEMORY);
    });

    return updatedId;
  }, []);

  const noteCorrectionApplied = useCallback((id: string) => {
    const now = new Date().toISOString();
    setCorrections(prev => prev.map(entry =>
      entry.id === id
        ? {
            ...entry,
            appliedCount: (entry.appliedCount || 0) + 1,
            lastAppliedAt: now,
            updatedAt: now,
          }
        : entry,
    ));
  }, []);

  return (
    <AssistantCtx.Provider value={{ corrections, loaded, upsertCorrection, noteCorrectionApplied }}>
      {children}
    </AssistantCtx.Provider>
  );
}
