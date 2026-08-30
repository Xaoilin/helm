import { useState, useEffect, useRef } from 'react';
import { useSettingsContext } from "../store/contexts/SettingsContext";
import { useGamificationContext } from "../store/contexts/GamificationContext";
import {
  isSupabaseReady,
  isAuthenticated,
  getCurrentUserId,
  listInventoryOAuthClients,
  revokeInventoryOAuthClient,
  type InventoryOAuthClientApproval,
} from '../store/supabase';
import type { AssistantRuntimeStatus } from '../services/assistantAvailability';
import { DEFAULT_ASSISTANT_PROVIDER, ELEVENLABS_API_KEY, OLLAMA_ENDPOINT } from '../config';
import { DEFAULT_PROFILE } from '../services/gamification';
import { getAssistantProviderSetting, getAssistantRuntimeStatus } from '../services/assistantAvailability';
import {
  HOSTED_ASSISTANT_MODEL_OPTIONS,
  getHostedAssistantModelLabel,
  getHostedAssistantModelOption,
  getHostedAssistantModelSetting,
} from '../services/assistantModels';
import { canUseHostedAssistantProjectAccess, isLocalhostRuntime } from '../services/hostedAssistantAccess';
import { testOllamaConnection, listOllamaModels } from '../services/ollamaApi';
import { APP_RELEASE_VERSION } from '../config/release';
import {
  getSyncSessionSnapshot,
  refreshDatabasePersistence,
  subscribeSyncSession,
} from '../store/persistence';
import { usePrayerContext } from '../store/contexts/PrayerContext';
import { PRAYER_REMINDERS } from '../config/constants';
import { createPrayerTrackingState } from '../services/prayerTracking';
import { useDailyMomentumContext } from '../store/contexts/DailyMomentumContext';
import { DAILY_MOMENTUM_REMINDER_ANCHORS } from '../services/dailyMomentum';
import { getSupportedIanaTimeZones } from '../services/appTimeZone';
import { validateIanaTimeZone } from '../services/timeZone';

export default function SettingsSurface() {
  const settingsContext = useSettingsContext();
  const gamification = useGamificationContext();
  const prayer = usePrayerContext();
  const momentum = useDailyMomentumContext();
  const { settings } = settingsContext;
  const linaEnabled = settings.assistantEnabled !== false;
  const [confirmReset, setConfirmReset] = useState(false);
  const [prayerTestStatus, setPrayerTestStatus] = useState<string | null>(null);
  const [syncSession, setSyncSession] = useState(() => getSyncSessionSnapshot());
  const [inventoryClients, setInventoryClients] = useState<InventoryOAuthClientApproval[]>([]);
  const [inventoryClientStatus, setInventoryClientStatus] = useState('');
  const [appTimeZoneInput, setAppTimeZoneInput] = useState(settings.appTimezone || '');
  const [appTimeZoneStatus, setAppTimeZoneStatus] = useState<{
    tone: 'saving' | 'saved' | 'error';
    message: string;
  } | null>(null);
  const supportedTimeZones = useState(() => getSupportedIanaTimeZones())[0];

  // Goal tags
  const [newTag, setNewTag] = useState('');
  const [assistantStatus, setAssistantStatus] = useState<AssistantRuntimeStatus>({
    activeProvider: null,
    state: 'checking',
    headline: 'Checking assistant runtime...',
    detail: 'Lina is checking which AI provider is currently available.',
  });
  const selectedProvider = getAssistantProviderSetting(settings);
  const selectedHostedModel = getHostedAssistantModelSetting(settings);
  const selectedHostedModelOption = getHostedAssistantModelOption(selectedHostedModel);
  const authSyncKey = `${isSupabaseReady()}:${isAuthenticated()}:${getCurrentUserId() || ''}`;
  const hostedProjectAccessAvailable = canUseHostedAssistantProjectAccess();
  const localhostRuntime = isLocalhostRuntime();

  // Microphone devices
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    // Need to request mic permission first to get labels
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then(devices => setMicrophones(devices.filter(d => d.kind === 'audioinput')))
      .catch(() => {}); // Permission denied — no mic list
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAssistantRuntimeStatus({
      assistantProvider: selectedProvider,
      hostedModel: selectedHostedModel,
      ollamaEndpoint: settings.ollamaEndpoint,
    }).then(status => {
      if (!cancelled) setAssistantStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedHostedModel, selectedProvider, settings.ollamaEndpoint, authSyncKey]);

  useEffect(() => subscribeSyncSession(setSyncSession), []);

  useEffect(() => {
    setAppTimeZoneInput(settings.appTimezone || '');
  }, [settings.appTimezone]);

  useEffect(() => {
    if (!isAuthenticated()) return;
    let cancelled = false;
    void listInventoryOAuthClients()
      .then(clients => { if (!cancelled) setInventoryClients(clients); })
      .catch(error => { if (!cancelled) setInventoryClientStatus(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [authSyncKey]);

  const revokeInventoryClient = async (client: InventoryOAuthClientApproval) => {
    setInventoryClientStatus(`Revoking ${client.clientName}…`);
    try {
      await revokeInventoryOAuthClient(client.clientId);
      setInventoryClients(current => current.map(entry => entry.clientId === client.clientId
        ? { ...entry, revokedAt: new Date().toISOString() }
        : entry));
      setInventoryClientStatus(`${client.clientName} can no longer access Inventory.`);
    } catch (error) {
      void listInventoryOAuthClients()
        .then(setInventoryClients)
        .catch(() => { /* the original revocation result remains authoritative */ });
      setInventoryClientStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Settings</h1>
          <div className="subtitle">Execution, privacy, and preference controls</div>
        </div>
      </div>
      <div className="surface-body">
        {/* Data Sync Status */}
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Data Sync</h3>
        <div className="card">
          <div className="sync-status-card">
            <span
              className={`sync-status-dot ${
                syncSession.status === 'ready' ? 'healthy' : 'syncing'
              }`}
              aria-hidden="true"
            />
            <div className="sync-status-copy">
              <div className="sync-status-title">
                {syncSession.status === 'ready'
                  ? 'Database source of truth'
                  : syncSession.hasUsableSnapshot ? 'Last confirmed data (read-only)' : 'Loading database state'}
              </div>
              <div className="sync-status-detail">
                {`Signed in as ${getCurrentUserId()?.slice(0, 8)}... Shared data belongs to this account and is read and written through Supabase only. Sabah One resolves concurrent updates automatically.`}
              </div>
            </div>
            <div className="sync-status-actions">
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => void refreshDatabasePersistence()}
                disabled={syncSession.status !== 'ready' || syncSession.readOnly}
              >
                Refresh from database
              </button>
            </div>
          </div>
          <div className="sync-drift-summary healthy">
            <strong>No sync decisions required</strong>
            <span>Legacy device copies are resolved additively and retired automatically after the database confirms the result.</span>
          </div>
        </div>

        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Codex Inventory Access</h3>
        <div className="card inventory-client-settings">
          <div className="inventory-client-settings-intro">
            <div>
              <strong>Approved Inventory clients</strong>
              <p>Each client is individually revocable. Access is limited in the database to Inventory records and minimal project name resolution.</p>
            </div>
            <span className="tag tag-primary">OAuth 2.1 beta</span>
          </div>
          <div className="inventory-client-boundary">Chats, calendars, finance, secrets, generic snapshots, and every non-Inventory RPC stay blocked.</div>
          <div className="inventory-client-list">
            {inventoryClients.length === 0 && <div className="inventory-empty-inline">No Codex Inventory client has been approved.</div>}
            {inventoryClients.map(client => (
              <div key={client.clientId} className="inventory-client-row">
                <div><strong>{client.clientName}</strong><span>{client.clientId}</span><small>{client.revokedAt ? `Revoked ${new Date(client.revokedAt).toLocaleString()}` : `Approved ${new Date(client.approvedAt).toLocaleString()}`}</small></div>
                <button className="btn btn-danger btn-sm" type="button" disabled={Boolean(client.revokedAt)} onClick={() => void revokeInventoryClient(client)}>{client.revokedAt ? 'Revoked' : 'Revoke'}</button>
              </div>
            ))}
          </div>
          {inventoryClientStatus && <div className="inventory-client-status" role="status">{inventoryClientStatus}</div>}
        </div>

        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>App time zone</h3>
        <div className="card app-time-zone-settings">
          <div className="app-time-zone-heading">
            <div>
              <strong>{settingsContext.appTimeZone.source === 'preference' ? 'Account time zone' : 'Automatic'}</strong>
              <span>Effective zone: {settingsContext.appTimeZone.effectiveTimeZone}</span>
            </div>
            <span className="app-time-zone-source">
              Browser: {settingsContext.appTimeZone.browserTimeZone || 'Unavailable'}
            </span>
          </div>
          <div className="form-group app-time-zone-field">
            <label htmlFor="settings-app-time-zone">IANA time zone</label>
            <input
              id="settings-app-time-zone"
              className={`form-input ${appTimeZoneStatus?.tone === 'error' ? 'is-invalid' : ''}`}
              list="settings-app-time-zone-options"
              placeholder="Automatic (browser time zone)"
              value={appTimeZoneInput}
              aria-describedby="settings-app-time-zone-help settings-app-time-zone-status"
              onChange={event => {
                setAppTimeZoneInput(event.target.value);
                setAppTimeZoneStatus(null);
              }}
            />
            <datalist id="settings-app-time-zone-options">
              {supportedTimeZones.map(timeZone => <option key={timeZone} value={timeZone} />)}
            </datalist>
            <div id="settings-app-time-zone-help" className="app-time-zone-help">
              Leave blank for Automatic. This account-shared setting controls generic app, assistant, and calendar time. Prayer schedules always retain their own validated zone.
            </div>
          </div>
          <div className="actions-row app-time-zone-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={appTimeZoneStatus?.tone === 'saving'}
              onClick={async () => {
                const rawTimeZone = appTimeZoneInput.trim();
                if (rawTimeZone && !validateIanaTimeZone(rawTimeZone)) {
                  setAppTimeZoneStatus({
                    tone: 'error',
                    message: 'Enter a valid IANA time zone, such as Europe/London.',
                  });
                  return;
                }
                setAppTimeZoneStatus({ tone: 'saving', message: 'Saving to your account…' });
                try {
                  await settingsContext.saveAppTimeZonePreference(rawTimeZone || undefined);
                  setAppTimeZoneStatus({
                    tone: 'saved',
                    message: rawTimeZone
                      ? `Saved ${rawTimeZone} to your account.`
                      : `Saved Automatic (${settingsContext.appTimeZone.browserTimeZone || 'UTC'}) to your account.`,
                  });
                } catch (error) {
                  setAppTimeZoneStatus({
                    tone: 'error',
                    message: error instanceof Error ? error.message : 'The time zone was not saved.',
                  });
                }
              }}
            >
              {appTimeZoneStatus?.tone === 'saving' ? 'Saving…' : 'Save time zone'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={appTimeZoneStatus?.tone === 'saving'}
              onClick={async () => {
                setAppTimeZoneStatus({ tone: 'saving', message: 'Resetting to Automatic…' });
                try {
                  await settingsContext.saveAppTimeZonePreference(undefined);
                  setAppTimeZoneInput('');
                  setAppTimeZoneStatus({
                    tone: 'saved',
                    message: `Automatic restored (${settingsContext.appTimeZone.browserTimeZone || 'UTC'}).`,
                  });
                } catch (error) {
                  setAppTimeZoneStatus({
                    tone: 'error',
                    message: error instanceof Error ? error.message : 'Automatic was not restored.',
                  });
                }
              }}
            >
              Use Automatic
            </button>
          </div>
          {(settingsContext.appTimeZoneLoadWarning || appTimeZoneStatus) && (
            <div
              id="settings-app-time-zone-status"
              className={`app-time-zone-status ${appTimeZoneStatus?.tone || 'error'}`}
              role={appTimeZoneStatus?.tone === 'error' || settingsContext.appTimeZoneLoadWarning ? 'alert' : 'status'}
            >
              {appTimeZoneStatus?.message || settingsContext.appTimeZoneLoadWarning}
            </div>
          )}
          {prayer.schedule?.timezone
            && prayer.schedule.timezone !== settingsContext.appTimeZone.effectiveTimeZone && (
            <div className="app-time-zone-prayer-boundary" role="status">
              Prayer times remain on {prayer.schedule.timezone}; app time uses {settingsContext.appTimeZone.effectiveTimeZone}.
            </div>
          )}
        </div>

        {/* Google Calendar */}
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Calendar</h3>
        <div className="card">
          <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
            <label htmlFor="settings-default-cal-view">Default calendar view</label>
            <select
              id="settings-default-cal-view"
              className="form-select"
              style={{ maxWidth: 200 }}
              value={settings.defaultCalendarTab || 'week'}
              onChange={e => settingsContext.updateSettings({ defaultCalendarTab: e.target.value as 'month' | 'week' | 'agenda' | 'accounts' })}
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="agenda">Agenda</option>
            </select>
            <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 4 }}>
              The tab shown when you open the Calendar.
            </div>
          </div>
        </div>

        {/* Goal categories */}
        {/* Prayer Times */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Prayer times and reminders</h3>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Enable prayer tracking and Adhan</div>
              <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 2 }}>
                Show the Jafari timetable, prayer outcomes, and global Adhan notifications.
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings.prayerEnabled !== false} onChange={e => settingsContext.updateSettings({ prayerEnabled: e.target.checked })} aria-label="Toggle prayer notifications" />
              <span className="slider" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="settings-prayer-city">City</label>
              <input id="settings-prayer-city" className="form-input" value={settings.prayerCity || 'Bedford'} onChange={e => settingsContext.updateSettings({ prayerCity: e.target.value })} />
            </div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="settings-prayer-country">Country</label>
              <input id="settings-prayer-country" className="form-input" value={settings.prayerCountry || 'United Kingdom'} onChange={e => settingsContext.updateSettings({ prayerCountry: e.target.value })} />
            </div>
          </div>
          <div className="prayer-settings-reminder-row">
            <div>
              <div className="prayer-settings-title">Warn before the on-time deadline</div>
              <div className="prayer-settings-copy">
                Pulse across every Sabah One surface and send one browser notification while this page is open.
              </div>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.prayerReminderEnabled !== false}
                disabled={settings.prayerEnabled === false}
                onChange={event => settingsContext.updateSettings({ prayerReminderEnabled: event.target.checked })}
                aria-label="Toggle prayer deadline reminders"
              />
              <span className="slider" />
            </label>
          </div>
          <div className="form-group prayer-reminder-lead">
            <label htmlFor="settings-prayer-reminder-minutes">Reminder lead time</label>
            <select
              id="settings-prayer-reminder-minutes"
              className="form-select"
              value={settings.prayerReminderMinutes ?? PRAYER_REMINDERS.DEFAULT_MINUTES}
              disabled={settings.prayerEnabled === false || settings.prayerReminderEnabled === false}
              onChange={event => settingsContext.updateSettings({
                prayerReminderMinutes: Number(event.target.value) as 5 | 10 | 15 | 30,
              })}
            >
              {PRAYER_REMINDERS.OPTIONS_MINUTES.map(minutes => (
                <option key={minutes} value={minutes}>{minutes} minutes before</option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 11, color: '#6b6f85', marginTop: 8 }}>
            Method: Shia Ithna-Ashari (Jafari), Leva Institute, Qum.{' '}
            <a href="https://aladhan.com/calculation-methods" target="_blank" rel="noopener noreferrer" style={{ color: '#4f5bff' }}>Learn more</a>
          </div>
          <div className="prayer-settings-runtime-note">
            Browser timers run while this page is open. They pause when the page is closed; browser notification delivery depends on permission and browser policy.
          </div>
          <div className="momentum-reminder-settings" aria-labelledby="momentum-reminder-settings-title">
            <div>
              <div id="momentum-reminder-settings-title" className="prayer-settings-title">Learn and Move reminders</div>
              <div className="prayer-settings-copy">
                Account-owned preferences. Prompts follow the selected prayer opportunities, coalesce when simultaneous, and stay quiet from 22:00 to 08:00.
              </div>
            </div>
            {(['learn', 'move'] as const).map(pillar => {
              const preference = momentum.state.reminderPreferences[pillar];
              const label = pillar === 'learn' ? 'Learn' : 'Move';
              return (
                <fieldset key={pillar} className="momentum-reminder-pillar" disabled={!momentum.loaded || momentum.saving}>
                  <legend>{label}</legend>
                  <label className="momentum-reminder-enable">
                    <input
                      type="checkbox"
                      checked={preference.enabled}
                      onChange={event => void momentum.updateReminderPreference(pillar, {
                        ...preference,
                        enabled: event.target.checked,
                      })}
                    />
                    <span>Enable {label} notifications</span>
                  </label>
                  <div className="momentum-reminder-anchors" aria-label={`${label} reminder prayer anchors`}>
                    {DAILY_MOMENTUM_REMINDER_ANCHORS[pillar].map(prayerName => (
                      <label key={prayerName}>
                        <input
                          type="checkbox"
                          checked={preference.afterPrayers.includes(prayerName)}
                          disabled={!preference.enabled}
                          onChange={event => {
                            const afterPrayers = event.target.checked
                              ? [...preference.afterPrayers, prayerName]
                              : preference.afterPrayers.filter(name => name !== prayerName);
                            void momentum.updateReminderPreference(pillar, { ...preference, afterPrayers });
                          }}
                        />
                        <span>After {prayerName}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            {momentum.error && <div className="prayer-settings-timezone-warning" role="alert">{momentum.error}</div>}
          </div>
          {!prayer.scheduleTimezoneValid && prayer.schedule && (
            <div className="prayer-settings-timezone-warning" role="alert">
              Reminders paused: the schedule timezone is invalid or missing.
            </div>
          )}
          {prayer.scheduleStatus === 'unavailable' && (
            <div className="prayer-settings-timezone-warning" role="alert">
              Schedule-relative reminders are paused. {prayer.scheduleError || 'Retry the prayer schedule.'}
            </div>
          )}
          <div className="prayer-settings-test">
            <div className="prayer-settings-title">Notification permission and test</div>
            {prayer.diagnostics.permissionState !== 'granted' && (
              <div className="prayer-settings-timezone-warning" role="alert">
                Browser notifications are unavailable. In-app reminders remain visible until permission is repaired.
              </div>
            )}
            <div className="actions-row">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  const result = await prayer.requestReminderPermission();
                  setPrayerTestStatus(result === 'granted' ? 'Notification permission granted.' : `Notification permission: ${result}.`);
                }}
              >
                Request permission
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  const sent = await prayer.testReminder('Fajr');
                  setPrayerTestStatus(sent
                    ? 'Labelled TEST scheduled for five seconds from now. Minimize Sabah One now.'
                    : 'Test not scheduled. Grant notification permission first or check Prayer Debug.');
                }}
              >
                Schedule labelled test (5 sec)
              </button>
            </div>
            {prayerTestStatus && <div className="prayer-settings-test-status" role="status">{prayerTestStatus}</div>}
          </div>
        </div>

        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Goal Categories</h3>
        <div className="card">
          <div style={{ fontSize: 12, color: '#9499b0', marginBottom: 10 }}>
            Organize your goals by category. These appear as filters and tags in the Goals tab.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {(settings.goalTags || []).map(tag => (
              <span key={tag} className="tag tag-goal" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px' }}>
                {tag}
                <button
                  style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
                  onClick={() => settingsContext.updateSettings({ goalTags: (settings.goalTags || []).filter(t => t !== tag) })}
                  aria-label={`Remove ${tag} category`}
                >
                  &times;
                </button>
              </span>
            ))}
            {(settings.goalTags || []).length === 0 && (
              <span style={{ fontSize: 12, color: '#6b6f85' }}>No categories yet</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              style={{ maxWidth: 200 }}
              placeholder="New category..."
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newTag.trim()) {
                  const tags = settings.goalTags || [];
                  if (!tags.includes(newTag.trim())) {
                    settingsContext.updateSettings({ goalTags: [...tags, newTag.trim()] });
                  }
                  setNewTag('');
                }
              }}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={!newTag.trim()}
              onClick={() => {
                const tags = settings.goalTags || [];
                if (!tags.includes(newTag.trim()) && newTag.trim()) {
                  settingsContext.updateSettings({ goalTags: [...tags, newTag.trim()] });
                }
                setNewTag('');
              }}
            >
              Add
            </button>
          </div>
        </div>

        {/* Privacy */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Privacy</h3>
        <div className="card">
          <div style={{ marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Private usage history</div>
              <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 2 }}>
                Signed-in visits, actions, outcomes, errors, and timings are stored in your own
                Sabah One account. Content, secrets, financial values, and provider payloads are
                excluded, and app usage never grants Life Hero XP.
              </div>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="settings-data-retention">Data retention (days)</label>
            <input
              id="settings-data-retention"
              className="form-input"
              type="number"
              min={7}
              max={365}
              value={settings.dataRetentionDays}
              onChange={e => settingsContext.updateSettings({ dataRetentionDays: Math.max(7, Math.min(365, parseInt(e.target.value) || 90)) })}
              style={{ maxWidth: 120 }}
            />
            <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 4 }}>
              How long Sabah One retains local conversation history and logs.
            </div>
          </div>
        </div>

        {/* Appearance */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Appearance</h3>
        <div className="card">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="settings-theme">Theme</label>
            <select
              id="settings-theme"
              className="form-select"
              value={settings.theme}
              onChange={e => settingsContext.updateSettings({ theme: e.target.value as 'dark' | 'light' })}
              style={{ maxWidth: 200 }}
            >
              <option value="dark">Dark</option>
              <option value="light">Light (not yet implemented)</option>
            </select>
            {settings.theme === 'light' && (
              <div className="info-box warning" style={{ marginTop: 8 }}>
                Light theme is not yet available. The app will continue using the dark theme.
              </div>
            )}
          </div>
        </div>

        {/* Voice Assistant (Lina) */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Voice Assistant (Lina)</h3>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Enable Lina</div>
              <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 2 }}>
                Shows the floating Lina button and enables voice, wake word, and the <code style={{ background: '#1a1d2e', padding: '1px 4px', borderRadius: 4, fontSize: 10 }}>Ctrl+Shift+L</code> shortcut. Turn this off when you want Lina fully quiet. Chat in the Chat tab still works.
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={linaEnabled} onChange={e => settingsContext.updateSettings({ assistantEnabled: e.target.checked })} aria-label="Toggle Lina" />
              <span className="slider" />
            </label>
          </div>
          <div style={{ fontSize: 11, color: linaEnabled ? '#6b6f85' : '#f0c040', marginBottom: 10 }}>
            {linaEnabled
              ? 'Need fewer accidental wake-ups? Leave Lina on and turn off the wake word below.'
              : 'Lina is off. The floating button, keyboard shortcut, and wake word are all disabled until you turn her back on.'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Wake word ("Hey Lina")</div>
              <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 2 }}>
                Listens for "Hey Lina" using OpenWakeWord (runs locally in your browser via WASM — no network, no API key, completely free). Say the wake word and Lina opens automatically while Lina is enabled.
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings.wakeWordEnabled === true} onChange={e => settingsContext.updateSettings({ wakeWordEnabled: e.target.checked })} aria-label="Toggle wake word" />
              <span className="slider" />
            </label>
          </div>
          {!linaEnabled && (
            <div style={{ fontSize: 10, color: '#4a4e62', marginTop: -2, marginBottom: 10 }}>
              Wake-word listening is currently inactive because Lina is turned off.
            </div>
          )}
          {/* Language */}
          <div className="form-group" style={{ marginTop: 12, marginBottom: 12 }}>
            <label htmlFor="settings-assistant-provider">Open-ended AI mode</label>
            <select
              id="settings-assistant-provider"
              className="form-select"
              value={settings.assistantProvider || DEFAULT_ASSISTANT_PROVIDER}
              onChange={e => settingsContext.updateSettings({ assistantProvider: e.target.value as typeof settings.assistantProvider })}
            >
              <option value="auto">Auto (hosted first, then Ollama)</option>
              <option value="hosted">Hosted AI (OpenAI)</option>
              <option value="ollama">Local AI (Ollama only)</option>
            </select>
            <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
              {hostedProjectAccessAvailable
                ? `Hosted AI uses the Supabase Edge Function, this build's configured project access key, and the selected ${getHostedAssistantModelLabel(selectedHostedModel)} model${localhostRuntime ? ' on localhost' : ''}. Supabase sign-in is still used for sync; browser builds still cannot start Ollama for you.`
                : 'Hosted AI needs Supabase project access in this build. Browser builds still cannot start Ollama for you.'}
            </div>
            <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
              <label htmlFor="settings-hosted-model">Hosted OpenAI model</label>
              <select
                id="settings-hosted-model"
                className="form-select"
                value={selectedHostedModel}
                onChange={e => settingsContext.updateSettings({ hostedModel: e.target.value })}
              >
                {HOSTED_ASSISTANT_MODEL_OPTIONS.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.label} - {option.badge}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
                Applies whenever Hosted AI is selected, or when Auto mode lands on hosted OpenAI instead of Ollama.
              </div>
              <div style={{ marginTop: 8, padding: '10px 12px', background: '#10131b', border: '1px solid #1e2030', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  {selectedHostedModelOption?.label || selectedHostedModel}
                </div>
                <div style={{ fontSize: 10, color: '#4a4e62' }}>
                  {selectedHostedModelOption?.detail || 'This hosted model comes from the current build configuration.'}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 8, padding: '10px 12px', background: '#13151c', border: '1px solid #1e2030', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Runtime status</div>
              <div style={{ fontSize: 12, color: assistantStatus.state === 'ready' ? '#22c55e' : assistantStatus.state === 'checking' ? '#6b6f85' : assistantStatus.state === 'offline' ? '#ff6b6b' : '#f0c040' }}>
                {assistantStatus.headline}
              </div>
              <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
                {assistantStatus.detail}
              </div>
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 12, marginBottom: 12 }}>
            <label htmlFor="settings-assistant-lang">Response language</label>
            <select
              id="settings-assistant-lang"
              className="form-select"
              value={settings.assistantLanguage || 'en'}
              onChange={e => settingsContext.updateSettings({ assistantLanguage: e.target.value as 'en' | 'ar' })}
            >
              <option value="en">English</option>
              <option value="ar">العربية (Arabic)</option>
            </select>
            <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
              Lina will respond and listen in the selected language. Voice recognition also switches language.
            </div>
          </div>
          {/* Deepgram API Key — for speech-to-text */}
          <div className="form-group" style={{ marginTop: 12, marginBottom: 12 }}>
            <label htmlFor="settings-deepgram">Deepgram API Key (for voice input)</label>
            <input
              id="settings-deepgram"
              className="form-input"
              type="password"
              placeholder="Paste your Deepgram API key..."
              value={settings.deepgramApiKey || ''}
              onChange={e => settingsContext.updateSettings({ deepgramApiKey: e.target.value || undefined })}
            />
            <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
              Free at <a href="https://console.deepgram.com" target="_blank" rel="noreferrer" style={{ color: '#7c8aff' }}>console.deepgram.com</a> — comes with $200 credit.
              Enables reliable voice commands (bypasses Chrome&apos;s broken speech service).
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#6b6f85', marginBottom: 10 }}>
            {ELEVENLABS_API_KEY ? 'ElevenLabs voice output configured ✓' : 'Using browser voice output (configure ElevenLabs in .env for cloned voice)'}
          </div>
          <div style={{ fontSize: 10, color: '#4a4e62', marginBottom: 10 }}>
            Tip: if Lina mishears you, say <strong>"No, I said ..."</strong>. Sabah One stores that correction locally and reuses it for future voice and chat commands.
          </div>
          {microphones.length > 0 && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="settings-mic">Microphone</label>
              <select
                id="settings-mic"
                className="form-select"
                value={settings.microphoneDeviceId || ''}
                onChange={e => settingsContext.updateSettings({ microphoneDeviceId: e.target.value || undefined })}
              >
                <option value="">Default microphone</option>
                {microphones.map(mic => (
                  <option key={mic.deviceId} value={mic.deviceId}>
                    {mic.label || `Microphone ${mic.deviceId.slice(0, 8)}...`}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
                Used for "Hey Lina" wake word and voice commands.
              </div>
              <MicTester deviceId={settings.microphoneDeviceId} />
            </div>
          )}
        </div>

        {/* Ollama LLM */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Local AI (Ollama)</h3>
        <div className="card">
          <div style={{ fontSize: 12, color: '#9499b0', marginBottom: 10 }}>
            Connect to a local Ollama instance for desktop or local-fallback AI conversations. Install from <a href="https://ollama.com" target="_blank" rel="noreferrer" style={{ color: '#7c8aff' }}>ollama.com</a>, then run <code style={{ background: '#1a1d2e', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>ollama pull llama3.2</code>
          </div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label htmlFor="settings-ollama-endpoint">Ollama endpoint</label>
            <input
              id="settings-ollama-endpoint"
              className="form-input"
              placeholder="http://localhost:11434"
              value={settings.ollamaEndpoint || ''}
              onChange={e => settingsContext.updateSettings({ ollamaEndpoint: e.target.value || undefined })}
            />
          </div>
          <OllamaModelSelector
            key={settings.ollamaEndpoint || OLLAMA_ENDPOINT}
            endpoint={settings.ollamaEndpoint || OLLAMA_ENDPOINT}
            currentModel={settings.ollamaModel}
            onModelChange={(model) => settingsContext.updateSettings({ ollamaModel: model || undefined })}
          />
        </div>

        {/* Reset Gamification */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Gamification Reset</h3>
        <div className="card">
          <div style={{ fontSize: 12, color: '#9499b0', marginBottom: 10 }}>
            Reset all XP, levels, badges, streaks, habit tallies, and prayer stats back to zero. This cannot be undone.
          </div>
          {confirmReset ? (
            <div className="confirm-bar" role="alert">
              Are you sure? This will permanently reset ALL gamification progress.
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  gamification.updateGamification({
                    ...DEFAULT_PROFILE,
                    ...(gamification.gamification.dailyMomentumLearn
                      ? { dailyMomentumLearn: gamification.gamification.dailyMomentumLearn }
                      : {}),
                    ...(gamification.gamification.dailyMomentumMove
                      ? { dailyMomentumMove: gamification.gamification.dailyMomentumMove }
                      : {}),
                  });
                  prayer.replacePrayerTracking(createPrayerTrackingState());
                  setConfirmReset(false);
                }}
              >
                Yes, Reset Everything
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmReset(true)}>Reset All Progress</button>
          )}
        </div>

        {/* About */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>About</h3>
        <div className="card">
          <div style={{ fontSize: 13 }}>
            <strong>Sabah One</strong> {APP_RELEASE_VERSION}<br />
            <span style={{ color: '#6b6f85' }}>
              Account-backed personal assistant for software engineers.<br />
              Browser-only GitHub Pages runtime built with React and TypeScript.
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#6b6f85', marginTop: 8 }}>
            The same release version is pinned in the sidebar so you can always see which build you are using.
          </div>
          <div className="info-box" style={{ marginTop: 12 }}>
            Runtime status is reported where the feature actually lives:
            <br />
            Chat shows the active assistant runtime state, Calendar labels manual providers, Integrations marks simulated providers, and Projects keeps account-backed references together.
          </div>
        </div>
      </div>
    </>
  );
}

// ── Ollama Model Selector sub-component ──

// ── Microphone Tester sub-component ──

function MicTester({ deviceId }: { deviceId?: string }) {
  const [micState, setMicState] = useState<'idle' | 'recording' | 'playing'>('idle');
  const [level, setLevel] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startRecording = async () => {
    setError(null);
    setPlaybackUrl(null);
    chunksRef.current = [];

    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // Set up analyser for live level meter
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Animate level meter
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;
        setLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      // Record audio
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setPlaybackUrl(url);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(100);
      setMicState('recording');

      // Auto-stop after 5 seconds
      setTimeout(() => { if (mediaRecorderRef.current?.state === 'recording') stopRecording(); }, 5000);
    } catch (e) {
      setError(e instanceof Error && e.message.includes('NotAllowed')
        ? 'Microphone blocked. Click the lock icon in your browser address bar to allow.'
        : `Mic error: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  const stopRecording = () => {
    cancelAnimationFrame(animFrameRef.current);
    setLevel(0);
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    setMicState('idle');
  };

  const playRecording = () => {
    if (!playbackUrl) return;
    const audio = new Audio(playbackUrl);
    audioRef.current = audio;
    setMicState('playing');
    audio.onended = () => { setMicState('idle'); audioRef.current = null; };
    audio.onerror = () => { setMicState('idle'); audioRef.current = null; };
    audio.play();
  };

  const stopPlayback = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setMicState('idle');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (audioRef.current) audioRef.current.pause();
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ marginTop: 10, padding: 10, background: '#13151c', borderRadius: 8, border: '1px solid #1e2030' }}>
      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>Microphone Test</div>

      {/* Level meter */}
      {micState === 'recording' && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#22c55e', minWidth: 70 }}>🔴 Recording...</span>
            <div style={{ flex: 1, height: 8, background: '#1a1d2e', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${level}%`, height: '100%', borderRadius: 4,
                background: level > 60 ? '#22c55e' : level > 20 ? '#f59e0b' : '#4a4e63',
                transition: 'width 0.1s',
              }} />
            </div>
            <span style={{ fontSize: 10, color: '#6b6f85', minWidth: 30 }}>{level}%</span>
          </div>
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {micState === 'idle' && (
          <>
            <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={startRecording}>
              🎙️ Record Test
            </button>
            {playbackUrl && (
              <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={playRecording}>
                🔊 Play Back
              </button>
            )}
          </>
        )}
        {micState === 'recording' && (
          <button className="btn btn-danger btn-sm" style={{ fontSize: 11 }} onClick={stopRecording}>
            ⏹️ Stop Recording
          </button>
        )}
        {micState === 'playing' && (
          <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={stopPlayback}>
            ⏹️ Stop Playback
          </button>
        )}
        {playbackUrl && micState === 'idle' && (
          <span style={{ fontSize: 10, color: '#22c55e' }}>✓ Recording ready — click Play Back to listen</span>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#ff6b6b', marginTop: 6 }}>{error}</div>
      )}

      <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 6 }}>
        Record up to 5 seconds, then play back to verify your mic is working. The level meter shows live input volume.
      </div>
    </div>
  );
}

// ── Ollama Model Selector sub-component ──

function OllamaModelSelector({ endpoint, currentModel, onModelChange }: {
  endpoint: string;
  currentModel?: string;
  onModelChange: (model: string) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<'checking' | 'connected' | 'offline'>('checking');

  useEffect(() => {
    let cancelled = false;

    testOllamaConnection(endpoint).then(ok => {
      if (cancelled) return;
      if (ok) {
        setStatus('connected');
        listOllamaModels(endpoint).then(foundModels => {
          if (!cancelled) setModels(foundModels);
        });
      } else {
        setStatus('offline');
        setModels([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>Status:</span>
        <span style={{ fontSize: 12, color: status === 'connected' ? '#22c55e' : status === 'offline' ? '#ff6b6b' : '#6b6f85' }}>
          {status === 'checking' ? '⏳ Checking...' :
           status === 'connected' ? '🟢 Connected' :
           '🔴 Offline — start Ollama to enable AI'}
        </span>
        <button
          className="btn btn-secondary btn-sm"
          style={{ fontSize: 10, padding: '3px 8px' }}
          onClick={() => {
            setStatus('checking');
            testOllamaConnection(endpoint).then(ok => {
              setStatus(ok ? 'connected' : 'offline');
              if (ok) listOllamaModels(endpoint).then(setModels);
            });
          }}
        >
          Test
        </button>
      </div>
      {status === 'connected' && models.length > 0 && (
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="settings-ollama-model">Model</label>
          <select
            id="settings-ollama-model"
            className="form-select"
            value={currentModel || ''}
            onChange={e => onModelChange(e.target.value)}
          >
            <option value="">Default (qwen3)</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
            qwen3 (8B) recommended for English + Arabic. Smaller models like gemma3 or phi4-mini are faster.
          </div>
        </div>
      )}
    </>
  );
}
