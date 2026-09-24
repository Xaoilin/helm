import { useEffect, useState } from 'react';
import { checkPrayerBackendHealth, type PrayerBackendHealthCheck } from '../../services/prayerApi';

type ViewState = PrayerBackendHealthCheck | { status: 'checking' };

export default function PrayerBackendStatus() {
  const [check, setCheck] = useState<ViewState>({ status: 'checking' });

  useEffect(() => {
    let mounted = true;
    void checkPrayerBackendHealth().then(result => {
      if (mounted) setCheck(result);
    });
    return () => { mounted = false; };
  }, []);

  const message = check.status === 'checking'
    ? 'Checking…'
    : check.status === 'connected'
      ? 'Connected'
      : check.status === 'not_configured'
        ? 'Not configured'
        : `Unavailable (${check.detail})`;

  return (
    <p className="subtitle prayer-backend-status" role="status" aria-live="polite" aria-label="Spring Boot prayer backend">
      Spring Boot prayer backend: {message}
      {(check.status === 'unavailable' || check.status === 'not_configured') && ' Prayer features still use the current app path.'}
    </p>
  );
}
