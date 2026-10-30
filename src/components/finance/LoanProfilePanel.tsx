import { useState } from 'react';
import { v4 as uuid } from 'uuid';
import type { LoanOverpaymentProfile } from '../../types/domain';
import type { LoanProfileChange } from '../../services/backend/financeServiceApi';

interface Props {
  profiles: LoanOverpaymentProfile[];
  writable: boolean;
  saving: boolean;
  changeProfile?: (change: LoanProfileChange) => Promise<void>;
  makeProfile: (id: string, name: string, isDefault: boolean) => LoanOverpaymentProfile;
  loadProfile: (profile: LoanOverpaymentProfile) => void;
  newProfile: () => void;
}

export function LoanProfilePanel({ profiles, writable, saving, changeProfile, makeProfile, loadProfile, newProfile }: Props) {
  const initial = profiles.find(profile => profile.isDefault);
  const [loadedId, setLoadedId] = useState(initial?.id ?? '');
  const [selectedId, setSelectedId] = useState(initial?.id ?? '');
  const [draftId, setDraftId] = useState(() => uuid());
  const [name, setName] = useState(initial?.name ?? '');
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const selected = profiles.find(profile => profile.id === selectedId);

  const load = () => {
    if (!selected) return;
    try {
      loadProfile(selected);
      setLoadedId(selected.id);
      setName(selected.name);
      setIsDefault(selected.isDefault);
      setFailure('');
      setMessage(`Loaded “${selected.name}”.`);
    } catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
  };

  const save = async () => {
    if (!changeProfile) return;
    setMessage('');
    setFailure('');
    try {
      const profile = makeProfile(loadedId || draftId, name.trim(), isDefault);
      await changeProfile({ operation: 'save', profile });
      setLoadedId(profile.id);
      setSelectedId(profile.id);
      setMessage(`Saved “${profile.name}” to your account${profile.isDefault ? ' as your default' : ''}.`);
    } catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
  };

  const remove = async () => {
    const savedName = profiles.find(profile => profile.id === loadedId)?.name ?? name;
    if (!changeProfile || !loadedId || !window.confirm(`Delete the saved profile “${savedName}”? Your loans are unchanged.`)) return;
    setMessage('');
    setFailure('');
    try {
      await changeProfile({ operation: 'remove', profileId: loadedId, confirmed: true });
      setLoadedId('');
      setSelectedId('');
      setDraftId(uuid());
      setName('');
      setIsDefault(false);
      newProfile();
      setMessage('Profile deleted. The current scenario remains available to explore.');
    } catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
  };

  return <section className="loan-profile-panel banking-card" aria-label="Saved overpayment profiles">
    <h4>Saved profiles</h4>
    <p>Save these inputs to your account and load them on any device. A default profile loads automatically when you return to Loans.</p>
    <div className="loan-toolbar">
      <label>Saved profile<select className="form-select" aria-label="Saved profile" value={selectedId} disabled={saving} onChange={event => setSelectedId(event.target.value)}>
        <option value="">Choose a profile</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}{profile.isDefault ? ' (default)' : ''}</option>)}
      </select></label>
      <button className="btn btn-secondary" type="button" disabled={!selected || saving} onClick={load}>Load profile</button>
      <button className="btn btn-secondary" type="button" disabled={saving} onClick={() => {
        setLoadedId(''); setSelectedId(''); setDraftId(uuid()); setName(''); setIsDefault(false); setFailure('');
        newProfile();
        setMessage('Name and save a new profile using the current inputs.');
      }}>New profile from these inputs</button>
    </div>
    <div className="loan-toolbar">
      <label>Profile name<input className="form-input" maxLength={128} value={name} disabled={saving} onChange={event => setName(event.target.value)} placeholder="e.g. Monthly overpayment plan" /></label>
      <label className="loan-profile-default"><input type="checkbox" checked={isDefault} disabled={saving} onChange={event => setIsDefault(event.target.checked)} /> Load this profile by default</label>
      <button className="btn btn-primary" type="button" disabled={!writable || !name.trim() || saving || !changeProfile} onClick={() => void save()}>{saving ? 'Saving…' : loadedId ? 'Update profile' : 'Save profile'}</button>
      {loadedId && <button className="btn btn-danger" type="button" disabled={!writable || saving} onClick={() => void remove()}>Delete profile</button>}
    </div>
    {!writable && <p className="banking-muted">Connect to Finance to save profiles. You can continue exploring the calculator.</p>}
    {message && <p className="loan-saving" role="status">{message}</p>}
    {failure && <p className="banking-error" role="alert">{failure} Your inputs are still here.</p>}
    <p className="banking-muted">Profiles save planning assumptions, including the opening balance and first payment month. Review those dated figures when returning later. Edits are saved only when you press Save or Update.</p>
  </section>;
}
