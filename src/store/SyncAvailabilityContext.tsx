import { createContext, useContext, type ReactNode } from 'react';
import type { SyncSessionReason } from './persistence';

interface SyncAvailability {
  readOnly: boolean;
  reason: SyncSessionReason;
}

const SyncAvailabilityContext = createContext<SyncAvailability>({
  readOnly: false,
  reason: null,
});

export function SyncAvailabilityProvider({
  children,
  readOnly,
  reason,
}: SyncAvailability & { children: ReactNode }) {
  return (
    <SyncAvailabilityContext.Provider value={{ readOnly, reason }}>
      {children}
    </SyncAvailabilityContext.Provider>
  );
}

export function useSyncAvailability(): SyncAvailability {
  return useContext(SyncAvailabilityContext);
}
