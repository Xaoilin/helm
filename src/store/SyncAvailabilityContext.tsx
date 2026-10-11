import { createContext, useContext, type ReactNode } from 'react';

/** Read-only while the browser reports offline and no service response has contradicted it. */
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
