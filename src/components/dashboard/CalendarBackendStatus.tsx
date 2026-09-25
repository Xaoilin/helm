import { useEffect, useState } from 'react';
import {
  checkCalendarBackendHealth,
  checkCalendarDatabaseHealth,
  type CalendarBackendHealthCheck,
} from '../../services/calendarApi';

type ViewState = CalendarBackendHealthCheck | { status: 'checking' };

function statusMessage(check: ViewState) {
  return check.status === 'checking'
    ? 'Checking…'
    : check.status === 'connected'
      ? 'Connected'
      : check.status === 'not_configured'
        ? 'Not configured'
        : `Unavailable (${check.detail})`;
}

export default function CalendarBackendStatus() {
  const [backendCheck, setBackendCheck] = useState<ViewState>({ status: 'checking' });
  const [databaseCheck, setDatabaseCheck] = useState<ViewState>({ status: 'checking' });

  useEffect(() => {
    let mounted = true;
    void Promise.all([checkCalendarBackendHealth(), checkCalendarDatabaseHealth()]).then(([backend, database]) => {
      if (!mounted) return;
      setBackendCheck(backend);
      setDatabaseCheck(database);
    });
    return () => { mounted = false; };
  }, []);

  return (
    <div className="prayer-backend-status" aria-live="polite">
      <p className="subtitle" role="status" aria-label="Spring Boot calendar backend">
        Spring Boot calendar backend: {statusMessage(backendCheck)}
      </p>
      <p className="subtitle" role="status" aria-label="Spring Boot calendar database">
        Spring Boot calendar database: {statusMessage(databaseCheck)}
      </p>
    </div>
  );
}
