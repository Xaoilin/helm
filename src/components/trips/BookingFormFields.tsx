import { TRIP_BUDGET } from '../../config/constants';
import { getLegLabel, toTitleCase } from '../../services/tripDisplay';
import { TRANSPORT_MODE_OPTIONS, type BookingDraft, type BookingSeedableLeg } from '../../services/tripModel';
import type { TripBudgetEntryStatus, TripTransportMode } from '../../types/domain';

/** Booking fields shared by the Plan Trip wizard and the booking editor. */
export default function BookingFormFields({
  draft,
  onChange,
  legs,
  idPrefix,
  autoFocus,
}: {
  draft: BookingDraft;
  onChange: (updates: Partial<BookingDraft>) => void;
  legs: BookingSeedableLeg[];
  idPrefix: string;
  autoFocus?: boolean;
}) {
  const selectedLeg = draft.legId ? legs.find(leg => leg.id === draft.legId) : undefined;
  const destinationHint = selectedLeg ? getLegLabel(selectedLeg) : 'Not tied to one destination';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-destination`}>Destination</label>
        <select
          id={`${idPrefix}-destination`}
          className="form-select"
          value={draft.legId || ''}
          onChange={event => onChange({ legId: event.target.value || undefined })}
        >
          <option value="">Not tied to one destination</option>
          {legs.map(leg => (
            <option key={leg.id} value={leg.id}>{leg.city}, {leg.country}</option>
          ))}
        </select>
        <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>{destinationHint}</div>
      </div>

      {draft.kind === 'transport' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label htmlFor={`${idPrefix}-mode`}>Mode</label>
              <select
                id={`${idPrefix}-mode`}
                className="form-select"
                value={draft.mode}
                onChange={event => onChange({ mode: event.target.value as TripTransportMode })}
                autoFocus={autoFocus}
              >
                {TRANSPORT_MODE_OPTIONS.map(mode => (
                  <option key={mode} value={mode}>{toTitleCase(mode)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor={`${idPrefix}-cost`}>Cost</label>
              <input
                id={`${idPrefix}-cost`}
                className="form-input"
                inputMode="decimal"
                placeholder="120.00"
                value={draft.budgetAmount}
                onChange={event => onChange({ budgetAmount: event.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label htmlFor={`${idPrefix}-depart`}>Depart</label>
              <input
                id={`${idPrefix}-depart`}
                className="form-input"
                type="datetime-local"
                value={draft.departAt}
                onChange={event => onChange({ departAt: event.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor={`${idPrefix}-arrive`}>Arrive</label>
              <input
                id={`${idPrefix}-arrive`}
                className="form-input"
                type="datetime-local"
                value={draft.arriveAt}
                onChange={event => onChange({ arriveAt: event.target.value })}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label htmlFor={`${idPrefix}-property`}>Property</label>
              <input
                id={`${idPrefix}-property`}
                className="form-input"
                value={draft.propertyName}
                placeholder="Hotel, apartment, riad"
                onChange={event => onChange({ propertyName: event.target.value })}
                autoFocus={autoFocus}
              />
            </div>
            <div className="form-group">
              <label htmlFor={`${idPrefix}-cost`}>Cost</label>
              <input
                id={`${idPrefix}-cost`}
                className="form-input"
                inputMode="decimal"
                placeholder="480.00"
                value={draft.budgetAmount}
                onChange={event => onChange({ budgetAmount: event.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label htmlFor={`${idPrefix}-check-in`}>Check In</label>
              <input
                id={`${idPrefix}-check-in`}
                className="form-input"
                type="date"
                value={draft.checkInDate}
                onChange={event => onChange({ checkInDate: event.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor={`${idPrefix}-check-out`}>Check Out</label>
              <input
                id={`${idPrefix}-check-out`}
                className="form-input"
                type="date"
                value={draft.checkOutDate}
                onChange={event => onChange({ checkOutDate: event.target.value })}
              />
            </div>
          </div>
        </>
      )}

      <div className="form-group">
        <label htmlFor={`${idPrefix}-status`}>Payment Status</label>
        <select
          id={`${idPrefix}-status`}
          className="form-select"
          value={draft.budgetStatus}
          onChange={event => onChange({ budgetStatus: event.target.value as TripBudgetEntryStatus })}
        >
          {TRIP_BUDGET.STATUSES.map(status => (
            <option key={status.value} value={status.value}>{status.label}</option>
          ))}
        </select>
      </div>

      <details style={{ display: 'grid', gap: 12 }}>
        <summary style={{ cursor: 'pointer', color: '#cfd6f6', fontWeight: 600 }}>More details</summary>
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          <div className="form-group">
            <label htmlFor={`${idPrefix}-title`}>Title</label>
            <input
              id={`${idPrefix}-title`}
              className="form-input"
              value={draft.title}
              onChange={event => onChange({ title: event.target.value })}
            />
          </div>

          {draft.kind === 'transport' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label htmlFor={`${idPrefix}-from`}>From</label>
                <input
                  id={`${idPrefix}-from`}
                  className="form-input"
                  value={draft.fromLabel}
                  onChange={event => onChange({ fromLabel: event.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor={`${idPrefix}-to`}>To</label>
                <input
                  id={`${idPrefix}-to`}
                  className="form-input"
                  value={draft.toLabel}
                  onChange={event => onChange({ toLabel: event.target.value })}
                />
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor={`${idPrefix}-address`}>Address</label>
              <input
                id={`${idPrefix}-address`}
                className="form-input"
                value={draft.address}
                onChange={event => onChange({ address: event.target.value })}
              />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label htmlFor={`${idPrefix}-provider`}>Provider</label>
              <input
                id={`${idPrefix}-provider`}
                className="form-input"
                value={draft.provider}
                onChange={event => onChange({ provider: event.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor={`${idPrefix}-confirmation`}>Confirmation Code</label>
              <input
                id={`${idPrefix}-confirmation`}
                className="form-input"
                value={draft.confirmationCode}
                onChange={event => onChange({ confirmationCode: event.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor={`${idPrefix}-link`}>Link</label>
            <input
              id={`${idPrefix}-link`}
              className="form-input"
              value={draft.link}
              onChange={event => onChange({ link: event.target.value })}
            />
          </div>

          <div className="form-group">
            <label htmlFor={`${idPrefix}-notes`}>Notes</label>
            <textarea
              id={`${idPrefix}-notes`}
              className="form-input"
              value={draft.notes}
              onChange={event => onChange({ notes: event.target.value })}
            />
          </div>
        </div>
      </details>
    </div>
  );
}
