import { formatDateTime, formatTripRange } from '../../services/tripDisplay';
import type { TripCalendarImport } from './useTripCalendarImport';

export default function TripCalendarImportModal({ calendarImport }: { calendarImport: TripCalendarImport }) {
  const { target, sources, sourceId, selectSource, close, confirm } = calendarImport;
  if (!target) return null;

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add to calendar">
        <h2>Add to Calendar</h2>
        <div className="info-box" style={{ marginBottom: 0 }}>
          <strong>{target.title}</strong><br />
          {target.allDay ? formatTripRange(target.start.slice(0, 10), target.end.slice(0, 10)) : `${formatDateTime(target.start)} -> ${formatDateTime(target.end)}`}
        </div>
        <div className="form-group">
          <label htmlFor="trip-calendar-source">Calendar Source</label>
          <select id="trip-calendar-source" className="form-select" value={sourceId} onChange={event => selectSource(event.target.value)}>
            {sources.map(source => (
              <option key={source.id} value={source.id}>{source.name}</option>
            ))}
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={close}>Cancel</button>
          <button className="btn btn-primary" onClick={confirm} disabled={!sourceId}>Add Event</button>
        </div>
      </div>
    </div>
  );
}
