import { createContext, useContext, type ReactNode } from 'react';

/** Account data is read-only while the browser is offline: no service can confirm a change. */
interface SyncAvailability {
  readOnly: boolean;
}

const SyncAvailabilityContext = createContext<SyncAvailability>({ readOnly: false });

export function SyncAvailabilityProvider({ children, readOnly }: SyncAvailability & { children: ReactNode }) {
  return (
    <SyncAvailabilityContext.Provider value={{ readOnly }}>
      {children}
    </SyncAvailabilityContext.Provider>
  );
}

export function useSyncAvailability(): SyncAvailability {
  return useContext(SyncAvailabilityContext);
}
