import { useMemo, useState, type CSSProperties } from 'react';
import { HEALTH_FAST_FOOD } from '../config/constants';
import { toLocalDateStr } from '../services/financeHelpers';
import { useHealthContext } from "../store/contexts/HealthContext";
import type {
  FastFoodExperienceRating,
  FastFoodLogEntry,
  FastFoodSymptom,
} from '../types/domain';

interface FastFoodDraft {
  venue: string;
  order: string;
  date: string;
  rating: FastFoodExperienceRating;
  symptoms: FastFoodSymptom[];
  notes: string;
}

const RATING_META: Record<FastFoodExperienceRating, { title: string; accent: string; summary: string }> = {
  good: { title: 'Felt fine', accent: '#44c789', summary: 'No real downside showed up afterwards.' },
  mixed: { title: 'Mixed', accent: '#f4b54a', summary: 'It was okay, but your body definitely noticed it.' },
  bad: { title: 'Bad', accent: '#ff8a5b', summary: 'The experience felt like a warning sign.' },
  awful: { title: 'Awful', accent: '#ff5f6d', summary: 'This one is worth remembering before the next craving.' },
};

function shiftLocalDate(base: Date, days: number): string {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return toLocalDateStr(next);
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function dayDifference(from: string, to: string): number {
  const fromDate = parseLocalDate(from);
  const toDate = parseLocalDate(to);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((toDate.getTime() - fromDate.getTime()) / msPerDay);
}

function formatEntryDate(value: string, today: string, yesterday: string): string {
  if (value === today) return 'Today';
  if (value === yesterday) return 'Yesterday';
  return parseLocalDate(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function symptomLabel(symptom: FastFoodSymptom): string {
  return HEALTH_FAST_FOOD.SYMPTOMS.find(option => option.value === symptom)?.label ?? symptom;
}

function buildDefaultDraft(referenceDate: Date): FastFoodDraft {
  return {
    venue: '',
    order: '',
    date: toLocalDateStr(referenceDate),
    rating: 'mixed',
    symptoms: [],
    notes: '',
  };
}

function entrySummary(entry: FastFoodLogEntry): string {
  if (entry.notes.trim()) return entry.notes.trim();
  if (entry.symptoms.length > 0) return entry.symptoms.map(symptomLabel).join(', ');
  return RATING_META[entry.rating].summary;
}

export default function HealthSurface() {
  const health = useHealthContext();
  const [referenceDate] = useState(() => new Date());
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FastFoodDraft>(() => buildDefaultDraft(referenceDate));

  const today = toLocalDateStr(referenceDate);
  const yesterday = shiftLocalDate(referenceDate, -1);

  const sortedEntries = useMemo(
    () => [...health.fastFoodEntries].sort((left, right) => {
      if (left.date !== right.date) return right.date.localeCompare(left.date);
      return right.updatedAt.localeCompare(left.updatedAt);
    }),
    [health.fastFoodEntries],
  );

  const latestEntry = sortedEntries[0] ?? null;
  const currentMonth = today.slice(0, 7);
  const entriesThisMonth = sortedEntries.filter(entry => entry.date.startsWith(currentMonth)).length;
  const roughDaysSinceFastFood = latestEntry ? dayDifference(latestEntry.date, today) : null;
  const difficultEntries = sortedEntries.filter(entry => entry.rating === 'bad' || entry.rating === 'awful').length;

  const topSymptom = useMemo(() => {
    const counts = new Map<FastFoodSymptom, number>();
    for (const entry of sortedEntries) {
      for (const symptom of entry.symptoms) {
        counts.set(symptom, (counts.get(symptom) ?? 0) + 1);
      }
    }

    const winner = [...counts.entries()]
      .sort((left, right) => right[1] - left[1])[0];

    if (!winner) return null;
    return { label: symptomLabel(winner[0]), count: winner[1], symptom: winner[0] };
  }, [sortedEntries]);

  const recentReminder = sortedEntries.find(entry => entry.rating === 'awful' || entry.rating === 'bad') ?? latestEntry;

  function resetDraft(nextDate = today) {
    setEditingEntryId(null);
    setDraft({
      venue: '',
      order: '',
      date: nextDate,
      rating: 'mixed',
      symptoms: [],
      notes: '',
    });
  }

  function toggleSymptom(symptom: FastFoodSymptom) {
    setDraft(current => {
      const hasSymptom = current.symptoms.includes(symptom);

      if (hasSymptom) {
        return {
          ...current,
          symptoms: current.symptoms.filter(item => item !== symptom),
        };
      }

      if (symptom === 'fine') {
        return {
          ...current,
          symptoms: ['fine'],
        };
      }

      return {
        ...current,
        symptoms: [...current.symptoms.filter(item => item !== 'fine'), symptom],
      };
    });
  }

  function startEditing(entry: FastFoodLogEntry) {
    setEditingEntryId(entry.id);
    setDraft({
      venue: entry.venue,
      order: entry.order ?? '',
      date: entry.date,
      rating: entry.rating,
      symptoms: entry.symptoms,
      notes: entry.notes,
    });
  }

  function saveEntry() {
    const venue = draft.venue.trim();
    if (!venue) return;

    const payload = {
      venue,
      order: draft.order.trim() || undefined,
      date: draft.date,
      rating: draft.rating,
      symptoms: draft.symptoms,
      notes: draft.notes.trim(),
    };

    if (editingEntryId) {
      health.updateFastFoodEntry(editingEntryId, payload);
      resetDraft(draft.date);
      return;
    }

    health.addFastFoodEntry(payload);
    resetDraft(today);
  }

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Health</h1>
          <div className="subtitle">A fast-food log that keeps the aftermath easy to remember.</div>
        </div>
      </div>
      <div className="surface-body health-surface">
        <section className="health-hero">
          <div className="health-hero-copy">
            <div className="health-eyebrow">Fast food journal</div>
            <h2>Make the craving compete with the consequences.</h2>
            <p>
              Log where you ate, how it landed, and the detail your future self needs when convenience starts
              sounding persuasive again.
            </p>
          </div>
          <div className="health-hero-metrics">
            <div className="health-hero-metric">
              <span className="label">This month</span>
              <strong>{entriesThisMonth}</strong>
              <span className="meta">logged fast food trips</span>
            </div>
            <div className="health-hero-metric">
              <span className="label">Rough patches</span>
              <strong>{difficultEntries}</strong>
              <span className="meta">bad or awful experiences</span>
            </div>
            <div className="health-hero-metric">
              <span className="label">Current gap</span>
              <strong>{roughDaysSinceFastFood === null ? 'No log yet' : `${roughDaysSinceFastFood} day${roughDaysSinceFastFood === 1 ? '' : 's'}`}</strong>
              <span className="meta">since the last entry</span>
            </div>
          </div>
        </section>

        <div className="health-layout">
          <section className="health-quick-log">
            <div className="health-panel health-entry-panel">
              <div className="health-panel-header">
                <div>
                  <div className="health-panel-eyebrow">{editingEntryId ? 'Editing log' : 'Quick log'}</div>
                  <h3>{editingEntryId ? 'Tighten the details' : 'Capture the experience while it is fresh'}</h3>
                </div>
                {editingEntryId && (
                  <button className="btn btn-secondary btn-sm" onClick={() => resetDraft(today)}>
                    Cancel
                  </button>
                )}
              </div>

              <div className="health-form-grid">
                <label className="health-field health-field-wide">
                  <span>Where did you eat?</span>
                  <input
                    className="form-input"
                    value={draft.venue}
                    onChange={(event) => setDraft(current => ({
                      ...current,
                      venue: event.target.value.slice(0, HEALTH_FAST_FOOD.MAX_VENUE_LENGTH),
                    }))}
                    placeholder="McDonald's, KFC, Burger King..."
                  />
                </label>

                <label className="health-field health-field-wide">
                  <span>What did you have? <em>Optional</em></span>
                  <input
                    className="form-input"
                    value={draft.order}
                    onChange={(event) => setDraft(current => ({
                      ...current,
                      order: event.target.value.slice(0, HEALTH_FAST_FOOD.MAX_ORDER_LENGTH),
                    }))}
                    placeholder="Big Mac meal, fries, milkshake..."
                  />
                </label>

                <label className="health-field">
                  <span>When was it?</span>
                  <input
                    className="form-input"
                    type="date"
                    value={draft.date}
                    onChange={(event) => setDraft(current => ({ ...current, date: event.target.value }))}
                  />
                  <div className="health-quick-dates">
                    <button className={`health-chip ${draft.date === today ? 'active' : ''}`} onClick={() => setDraft(current => ({ ...current, date: today }))}>
                      Today
                    </button>
                    <button className={`health-chip ${draft.date === yesterday ? 'active' : ''}`} onClick={() => setDraft(current => ({ ...current, date: yesterday }))}>
                      Yesterday
                    </button>
                  </div>
                </label>

                <div className="health-field health-field-wide health-rating-field">
                  <span>How bad was it?</span>
                  <div className="health-rating-grid">
                    {HEALTH_FAST_FOOD.RATINGS.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={draft.rating === option.value}
                        className={`health-rating-card ${draft.rating === option.value ? 'active' : ''} rating-${option.value}`}
                        onClick={() => setDraft(current => ({ ...current, rating: option.value }))}
                      >
                        <span className="emoji" aria-hidden="true">{option.emoji}</span>
                        <span className="title">{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="health-field health-field-wide">
                  <span>What happened afterwards?</span>
                  <div className="health-symptom-grid">
                    {HEALTH_FAST_FOOD.SYMPTOMS.map(option => (
                      <button
                        key={option.value}
                        className={`health-symptom-chip ${draft.symptoms.includes(option.value) ? 'active' : ''}`}
                        onClick={() => toggleSymptom(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="health-field health-field-wide">
                  <span>What do you want to remember?</span>
                  <textarea
                    className="form-input health-notes"
                    value={draft.notes}
                    onChange={(event) => setDraft(current => ({
                      ...current,
                      notes: event.target.value.slice(0, HEALTH_FAST_FOOD.MAX_NOTES_LENGTH),
                    }))}
                    placeholder="Example: nauseous for the entire day, felt heavy, not worth the convenience."
                  />
                  <div className="health-character-count">
                    {draft.notes.length} / {HEALTH_FAST_FOOD.MAX_NOTES_LENGTH}
                  </div>
                </label>
              </div>

              <div className="health-form-footer">
                <div className="health-form-hint">
                  Keep it short. A quick, honest note is more useful than a perfect one.
                </div>
                <button className="btn btn-primary" onClick={saveEntry} disabled={!draft.venue.trim()}>
                  {editingEntryId ? 'Update log' : 'Save fast food log'}
                </button>
              </div>
            </div>

            <div className="health-panel health-patterns-panel">
              <div className="health-panel-eyebrow">Patterns</div>
              <h3>What the log is already telling you</h3>
              <div className="health-pattern-list">
                <div className="health-pattern-item">
                  <span className="label">Most common after-effect</span>
                  <strong>{topSymptom ? topSymptom.label : 'Nothing logged yet'}</strong>
                  <span className="meta">
                    {topSymptom ? `${topSymptom.count} time${topSymptom.count === 1 ? '' : 's'}` : 'Start with one entry and this fills itself in.'}
                  </span>
                </div>
                <div className="health-pattern-item">
                  <span className="label">Latest reality check</span>
                  <strong>{recentReminder ? `${recentReminder.venue} ${formatEntryDate(recentReminder.date, today, yesterday).toLowerCase()}` : 'No reminder yet'}</strong>
                  <span className="meta">{recentReminder ? entrySummary(recentReminder) : 'Your toughest recent experience will show up here.'}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="health-history">
            <div className="health-panel health-history-panel">
              <div className="health-panel-header">
                <div>
                  <div className="health-panel-eyebrow">Recent logs</div>
                  <h3>Your fast food history</h3>
                </div>
                <div className="health-history-count">{sortedEntries.length} total</div>
              </div>

              {sortedEntries.length === 0 ? (
                <div className="health-empty-state">
                  <div className="health-empty-icon" aria-hidden="true">{'\u{1F35F}'}</div>
                  <h4>No fast food entries yet</h4>
                  <p>
                    Your first log only needs the place, the date, and one sentence about how it felt afterwards.
                  </p>
                </div>
              ) : (
                <div className="health-entry-list">
                  {sortedEntries.map(entry => (
                    <article
                      key={entry.id}
                      className={`health-entry-card rating-${entry.rating}`}
                      style={{ '--health-entry-accent': RATING_META[entry.rating].accent } as CSSProperties}
                    >
                      <div className="health-entry-topline">
                        <div>
                          <div className="health-entry-date">{formatEntryDate(entry.date, today, yesterday)}</div>
                          <h4>{entry.venue}</h4>
                        </div>
                        <span className={`health-rating-pill rating-${entry.rating}`}>
                          {RATING_META[entry.rating].title}
                        </span>
                      </div>

                      {entry.order && <div className="health-entry-order">{entry.order}</div>}

                      <p className="health-entry-summary">{entrySummary(entry)}</p>

                      {entry.symptoms.length > 0 && (
                        <div className="health-entry-symptoms">
                          {entry.symptoms.map(symptom => (
                            <span key={`${entry.id}-${symptom}`} className="health-entry-tag">
                              {symptomLabel(symptom)}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="health-entry-actions">
                        <button className="btn btn-secondary btn-sm" onClick={() => startEditing(entry)}>
                          Edit
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => {
                          health.removeFastFoodEntry(entry.id);
                          if (editingEntryId === entry.id) {
                            resetDraft(today);
                          }
                        }}>
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
