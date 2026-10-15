import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface ViewDataDemand {
  consumers: Record<string, readonly string[]>;
  register: (consumer: string, domains: readonly string[]) => () => void;
}

export const ViewDataDemandCtx = createContext<ViewDataDemand | null>(null);

/** An open overlay can consume domains beyond the underlying navigation surface. */
export function ViewDataDemandProvider({ children }: { children: ReactNode }) {
  const [consumers, setConsumers] = useState<Record<string, readonly string[]>>({});
  const register = useCallback((consumer: string, domains: readonly string[]) => {
    setConsumers(previous => ({ ...previous, [consumer]: domains }));
    return () => setConsumers(previous => {
      const next = { ...previous };
      delete next[consumer];
      return next;
    });
  }, []);
  const value = useMemo(() => ({ consumers, register }), [consumers, register]);
  return <ViewDataDemandCtx.Provider value={value}>{children}</ViewDataDemandCtx.Provider>;
}

export function useViewDataDemand(consumer: string, domains: readonly string[]): void {
  const register = useContext(ViewDataDemandCtx)?.register;
  const signature = domains.join('\u0000');
  useEffect(() => register?.(consumer, signature.split('\u0000')), [consumer, register, signature]);
}
