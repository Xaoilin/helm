import { useState, useEffect } from 'react';
import { useSettingsContext } from "../store/contexts/SettingsContext";
import { useGamificationContext } from "../store/contexts/GamificationContext";
import { useAuthSession } from '../store/AuthSessionContext';
import { OAuthClientApprovalsSection } from '../components/settings/OAuthClientApprovalsSection';
import { OAUTH_CLIENT_DOMAINS } from '../store/supabase/oauthClients';
import { DEFAULT_PROFILE } from '../services/gamification';
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
  const authSession = useAuthSession();
  const signedInUserId = authSession.authUser?.id ?? null;
  const { settings } = settingsContext;
  const [confirmReset, setConfirmReset] = useState(false);
  const [prayerTestStatus, setPrayerTestStatus] = useState<string | null>(null);
  const [syncSession, setSyncSession] = useState(() => getSyncSessionSnapshot());
  const [appTimeZoneInput, setAppTimeZoneInput] = useState(settings.appTimezone || '');
  const [appTimeZoneStatus, setAppTimeZoneStatus] = useState<{
    tone: 'saving' | 'saved' | 'error';
    message: string;
  } | null>(null);
  const supportedTimeZones = useState(() => getSupportedIanaTimeZones())[0];

  // Goal tags
  const [newTag, setNewTag] = useState('');

  useEffect(() => subscribeSyncSession(setSyncSession), []);

  useEffect(() => {
    setAppTimeZoneInput(settings.appTimezone || '');
  }, [settings.appTimezone]);

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
                {`Signed in as ${signedInUserId?.slice(0, 8)}... Shared data belongs to this account and is read and written through Supabase only. Sabah One resolves concurrent updates automatically.`}
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

        {OAUTH_CLIENT_DOMAINS.map(domain => <OAuthClientApprovalsSection key={domain} domain={domain} />)}

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
                excluded.
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
            Calendar labels manual providers, Integrations shows supported setup, and Projects keeps account-backed references together.
          </div>
        </div>
      </div>
    </>
  );
}
