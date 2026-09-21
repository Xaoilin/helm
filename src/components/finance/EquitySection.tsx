import { useState } from 'react';
import type { EquityPlan, EquityPosition } from '../../types/domain';
import { equityDate, equityMoney, equityResolutionDate, equityScenario, equityTotals } from '../../services/equity';
import { useEquityPositions } from '../../store/contexts/useEquityPositions';
import { EquityEditor } from './EquityEditor';
import './equity.css';

type View = 'overview' | 'stocks' | 'options';
const count = (value: number) => value.toLocaleString('en-GB');

function Plan({ plan }: { plan: EquityPlan }) {
  return <div className="equity-plan">
    <div className="equity-label">{plan.status === 'agreed' ? 'Agreed plan' : plan.status === 'tentative' ? 'Tentative plan' : 'Plan to decide'}</div>
    <p>{plan.summary || 'No plan recorded yet.'}</p>
    {plan.waitingFor && <p className="equity-secondary"><strong>Waiting for</strong> {plan.waitingFor}</p>}
    {plan.nextAction && <p className="equity-secondary"><strong>Next</strong> {plan.nextAction}</p>}
    {plan.reviewMonth && <p className="equity-review">Review {equityDate(plan.reviewMonth)}</p>}
  </div>;
}

function PositionSummary({ position, view }: { position: EquityPosition; view: View }) {
  const totals = equityTotals(position);
  return <div className="equity-grid">
    {view !== 'options' && <section className="equity-card" aria-label={`${position.company} Stocks`}>
      <h3>Stocks</h3>
      <div className="equity-number">{count(position.ownedShares)} <span>owned shares</span></div>
      <Plan plan={position.stockPlan} />
    </section>}
    {view !== 'stocks' && <section className="equity-card" aria-label={`${position.company} Options`}>
      <h3>Options</h3>
      <div className="equity-number">{count(totals.vested)} <span>vested, unexercised</span></div>
      <p className="equity-secondary">{count(totals.unvested)} unvested · {equityMoney(totals.strikeCostUsd, 'USD', 2)} strike cost</p>
      <Plan plan={position.optionPlan} />
    </section>}
  </div>;
}

function PositionDetails({ position, view }: { position: EquityPosition; view: View }) {
  const nextVests = position.grants.filter(grant => grant.nextVest);
  const deadlines = position.grants.filter(grant => grant.postEmploymentExpiry);
  return <div className="equity-details">
    {position.actions.length > 0 && <details>
      <summary>Next actions & deadlines</summary>
      <ul className="equity-actions">{position.actions.map(action => <li key={action.id}>
        <strong>{action.done ? 'Done · ' : ''}{action.title}</strong>
        <span>{action.dueDate && `${equityDate(action.dueDate)} · `}{action.timing}</span>
      </li>)}</ul>
      {position.employmentNote && <p>{position.employmentNote}</p>}
    </details>}
    {view !== 'stocks' && <>
      <details>
        <summary>Grants, vesting & expiry</summary>
        <p>Balances are recorded snapshots. Scheduled vesting never automatically increases your holdings.</p>
        <div className="equity-table-wrap"><table aria-label={`${position.company} option grants`}>
          <thead><tr><th>Grant</th><th>Vested</th><th>Unvested</th><th>Strike</th><th>Original expiry</th><th>Post-employment expiry</th></tr></thead>
          <tbody>{position.grants.map(grant => <tr key={grant.id}>
            <th scope="row">{grant.id}<small>{equityDate(grant.grantDate)}</small></th>
            <td>{count(grant.vested)}</td><td>{count(grant.unvested)}</td><td>{equityMoney(grant.strikeUsd, 'USD', 2)}</td>
            <td>{equityDate(grant.originalExpiry)}</td><td>{equityDate(grant.postEmploymentExpiry)}</td>
          </tr>)}</tbody>
        </table></div>
        <p>Original expiry dates are separate from departure deadlines. Confirm each grant's terms when leaving.</p>
        {nextVests.map(grant => <p key={grant.id}><strong>{grant.id}: +{count(grant.nextVest!.quantity)} on {equityDate(grant.nextVest!.date)}</strong> · {grant.nextVest!.condition}
          {grant.nextVest!.alternateDate && <> · Alternate display: {equityDate(grant.nextVest!.alternateDate)}; confirm the date.</>}
        </p>)}
        {deadlines.map(grant => <p key={grant.id}><strong>{grant.id}: begin resolving by {equityDate(equityResolutionDate(grant.postEmploymentExpiry!))}</strong> · Six months before the confirmed {equityDate(grant.postEmploymentExpiry)} expiry.</p>)}
      </details>
      <details>
        <summary>Illustrative option proceeds</summary>
        <p>What-if scenarios as of {equityDate(position.scenario.asOf)}. Excludes owned shares and fees; these amounts are not cash balances, bids or forecasts.</p>
        <div className="equity-table-wrap"><table aria-label={`${position.company} option scenarios`}>
          <thead><tr><th>Assumed price</th><th>Options in the money</th><th>Estimated net GBP</th></tr></thead>
          <tbody>{position.scenario.pricesUsd.map(price => {
            const result = equityScenario(position, price);
            return <tr key={price}><td>{equityMoney(price, 'USD', 2)}</td><td>{count(result.quantity)}</td><td>{equityMoney(result.netGbp, 'GBP')}</td></tr>;
          })}</tbody>
        </table></div>
        <p>Modeled withholding: {count(position.scenario.withholdingRate * 100)}% of the positive spread. USD → GBP: {position.scenario.usdToGbp}. Only vested options with strike below the assumed sale price are included.</p>
        <p>{position.scenario.notes}</p>
      </details>
    </>}
    {position.details.map(detail => <details key={detail.id}><summary>{detail.title}</summary><p className="equity-prose">{detail.body}</p></details>)}
    {position.sources.length > 0 && <details><summary>Private sources & verification</summary><ul className="equity-actions">{position.sources.map(source => <li key={source.id}>
      <a href={/^https?:\/\//u.test(source.url) ? source.url : undefined} target="_blank" rel="noopener noreferrer">{source.label}</a><span>Reviewed {equityDate(source.asOf)}</span>
    </li>)}</ul></details>}
  </div>;
}

export function EquitySection({ view = 'overview' }: { view?: View }) {
  const equity = useEquityPositions();
  const [editing, setEditing] = useState<EquityPosition | 'new' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  return <section className="equity-section" aria-label="Stocks and Options">
    <div className="equity-heading"><div><h2>{view === 'overview' ? 'Stocks & Options' : view === 'stocks' ? 'Stocks' : 'Options'}</h2><p className="equity-secondary">Private equity · tracked separately from cash and account net worth</p></div>
      <button className="btn btn-sm" disabled={!equity.writable || equity.saving} onClick={() => setEditing('new')}>+ Equity holding</button></div>
    {equity.error && <div className="equity-error" role="alert">{equity.error} <button className="btn btn-sm" onClick={() => void equity.refresh()}>Retry loading</button></div>}
    {!equity.loaded ? <p role="status">Loading equity…</p> : equity.positions.length === 0 && !equity.error ? <p>No equity holdings recorded. Add owned shares and option grants with a dated plan.</p> : null}
    {equity.positions.map(position => <article className="equity-position" key={position.id}>
      <div className="equity-heading"><div><h3>{position.company}</h3><span className="equity-secondary">As of {equityDate(position.asOf)}</span></div>
        <button className="btn btn-sm" disabled={!equity.writable || equity.saving} onClick={() => setEditing(position)}>Edit {position.company}</button></div>
      <PositionSummary position={position} view={view} />
      {view === 'overview' ? <details className="equity-overview-details"><summary>Actions, grants & supporting details</summary><PositionDetails position={position} view={view} /></details> : <PositionDetails position={position} view={view} />}
      {view !== 'overview' && <div className="equity-remove">{removing === position.id ? <><span>Remove this equity record?</span><button className="btn btn-danger btn-sm" disabled={equity.saving} onClick={() => { void equity.remove(position).then(() => setRemoving(null)).catch(() => { /* Hook displays the failure. */ }); }}>Confirm removal</button><button className="btn btn-sm" disabled={equity.saving} onClick={() => setRemoving(null)}>Cancel</button></> : <button className="btn btn-sm" disabled={!equity.writable || equity.saving} onClick={() => setRemoving(position.id)}>Remove holding</button>}</div>}
    </article>)}
    {editing && <EquityEditor position={editing === 'new' ? undefined : editing} saving={equity.saving} onClose={() => setEditing(null)} onSave={async draft => { await equity.save(draft, editing === 'new' ? undefined : editing); setEditing(null); }} />}
  </section>;
}
