import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEEPGRAM_API_KEY, OLLAMA_ENDPOINT } from '../../config';
import { useGoogleSync } from '../../hooks/useGoogleSync';
import { getHostedAssistantModelSetting } from '../../services/assistantModels';
import { testHostedAssistantConnection, type HostedAssistantConnectionStatus } from '../../services/hostedAssistantApi';
import { testOllamaConnection } from '../../services/ollamaApi';
import {
  buildSystemHealthSnapshot,
  sanitizeHealthDetail,
  type HealthActionKind,
  type HealthItem,
} from '../../services/systemHealth';
import { useShell } from "../../store/ShellContext";
import { useCalendar } from "../../store/contexts/CalendarContext";
import { useSettingsContext } from "../../store/contexts/SettingsContext";
import {
  getPersistenceHealthSnapshot,
  subscribePersistenceHealth,
  type PersistenceHealthSnapshot,
} from '../../store/persistence';
import {
  isAuthSessionBootstrapped,
  isAuthenticated,
  isSupabaseReady,
  signInWithGoogle,
} from '../../store/supabase';

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
};

function isBrowserSpeechAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const speechWindow = window as SpeechRecognitionWindow;
  return Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition);
}

function toneLabel(tone: HealthItem['tone']): string {
  switch (tone) {
    case 'healthy':
      return 'Ready';
    case 'syncing':
      return 'Syncing';
    case 'attention':
      return 'Needs attention';
    case 'offline':
      return 'Offline';
    case 'local':
      return 'Local';
    case 'checking':
    default:
      return 'Checking';
  }
}

export default function SystemStatusPanel() {
  const shell = useShell();
  const calendar = useCalendar();
  const settings = useSettingsContext();
  const googleSync = useGoogleSync();
  const mountedRef = useRef(true);
  const [persistence, setPersistence] = useState<PersistenceHealthSnapshot>(() => getPersistenceHealthSnapshot());
  const [hostedStatus, setHostedStatus] = useState<HostedAssistantConnectionStatus | null>(null);
  const [hostedChecking, setHostedChecking] = useState(true);
  const [hostedCheckedAt, setHostedCheckedAt] = useState<string | null>(null);
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  const [ollamaChecking, setOllamaChecking] = useState(true);
  const [ollamaCheckedAt, setOllamaCheckedAt] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const hostedModel = getHostedAssistantModelSetting(settings.settings);
  const ollamaEndpoint = settings.settings.ollamaEndpoint || OLLAMA_ENDPOINT;

  const applyProbeResults = useCallback((
    checkedAt: string,
    hostedResult: PromiseSettledResult<HostedAssistantConnectionStatus>,
    ollamaResult: PromiseSettledResult<boolean>,
  ) => {
    if (!mountedRef.current) return;

    setHostedStatus(hostedResult.status === 'fulfilled'
      ? hostedResult.value
      : { status: 'unavailable', message: hostedResult.reason instanceof Error ? hostedResult.reason.message : String(hostedResult.reason) });
    setHostedCheckedAt(checkedAt);
    setHostedChecking(false);

    setOllamaConnected(ollamaResult.status === 'fulfilled' ? ollamaResult.value : false);
    setOllamaCheckedAt(checkedAt);
    setOllamaChecking(false);
  }, []);

  const refreshStatus = useCallback(async () => {
    const checkedAt = new Date().toISOString();
    setActionError(null);
    setHostedChecking(true);
    setOllamaChecking(true);

    const [hostedResult, ollamaResult] = await Promise.allSettled([
      testHostedAssistantConnection({ model: hostedModel }),
      testOllamaConnection(ollamaEndpoint),
    ]);

    applyProbeResults(checkedAt, hostedResult, ollamaResult);
  }, [applyProbeResults, hostedModel, ollamaEndpoint]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = subscribePersistenceHealth(setPersistence);
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkedAt = new Date().toISOString();

    Promise.allSettled([
      testHostedAssistantConnection({ model: hostedModel }),
      testOllamaConnection(ollamaEndpoint),
    ]).then(([hostedResult, ollamaResult]) => {
      if (cancelled) return;
      applyProbeResults(checkedAt, hostedResult, ollamaResult);
    });

    return () => {
      cancelled = true;
    };
  }, [applyProbeResults, hostedModel, ollamaEndpoint]);

  const snapshot = useMemo(() => buildSystemHealthSnapshot({
    appLoaded: true,
    persistence,
    supabase: {
      ready: isSupabaseReady(),
      authenticated: isAuthenticated(),
      bootstrapped: isAuthSessionBootstrapped(),
    },
    calendar: {
      accounts: calendar.calendarAccounts,
      syncState: googleSync.syncState,
      lastSyncTime: googleSync.lastSyncTime,
      syncError: googleSync.syncError,
    },
    openAi: {
      status: hostedStatus,
      checking: hostedChecking,
      checkedAt: hostedCheckedAt,
    },
    ollama: {
      connected: ollamaConnected,
      checking: ollamaChecking,
      endpoint: ollamaEndpoint,
      checkedAt: ollamaCheckedAt,
    },
    voice: {
      settings: settings.settings,
      deepgramKeyPresent: Boolean(DEEPGRAM_API_KEY || settings.settings.deepgramApiKey),
      browserSpeechAvailable: isBrowserSpeechAvailable(),
    },
  }), [
    calendar.calendarAccounts,
    settings.settings,
    googleSync.lastSyncTime,
    googleSync.syncError,
    googleSync.syncState,
    hostedCheckedAt,
    hostedChecking,
    hostedStatus,
    ollamaCheckedAt,
    ollamaChecking,
    ollamaConnected,
    ollamaEndpoint,
    persistence,
  ]);

  const handleAction = useCallback(async (kind: HealthActionKind) => {
    setActionError(null);
    try {
      switch (kind) {
        case 'refresh':
          await refreshStatus();
          break;
        case 'sign-in':
          await signInWithGoogle();
          break;
        case 'settings':
          shell.navigate('settings');
          break;
        case 'integrations':
          shell.navigate('integrations');
          break;
        case 'calendar':
          shell.navigate('calendar');
          break;
        default:
          break;
      }
    } catch (error) {
      setActionError(sanitizeHealthDetail(error instanceof Error ? error.message : String(error)));
    }
  }, [refreshStatus, shell]);

  return (
    <section className="system-status-panel dash-card" aria-label="System status">
      <div className="system-status-header">
        <div>
          <div className="dash-card-header system-status-title">
            <span>System status</span>
            <span className={`system-status-summary tone-${snapshot.overallTone}`}>{snapshot.summary}</span>
          </div>
        </div>
        <button className="btn btn-secondary btn-sm system-status-refresh" onClick={() => void handleAction('refresh')}>
          Refresh status
        </button>
      </div>

      {actionError && (
        <div className="system-status-error" role="status">
          {actionError}
        </div>
      )}

      <div className="system-status-grid">
        {snapshot.items.map(item => {
          const action = item.action;

          return (
            <article key={item.id} className={`system-status-item tone-${item.tone}`}>
              <span className={`system-status-dot tone-${item.tone}`} aria-hidden="true" />
              <div className="system-status-item-body">
                <div className="system-status-kicker">
                  <span>{item.label}</span>
                  <span>{toneLabel(item.tone)}</span>
                </div>
                <div className="system-status-headline">{item.headline}</div>
                <div className="system-status-detail">{item.detail}</div>
                <div className="system-status-footer">
                  {item.meta && <span className="system-status-meta">{item.meta}</span>}
                  {action && (
                    <button
                      className="btn btn-secondary btn-sm system-status-action"
                      onClick={() => void handleAction(action.kind)}
                    >
                      {action.label}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
