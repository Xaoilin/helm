import { useContext } from 'react';
import { ShellContext } from '../ShellContext';
import { ViewDataDemandCtx } from '../ViewDataDemand';
import type { Surface } from '../../types/domain';

/** Shared prayer/planner dependencies, including Clock alarms, stay active across every view. */
const OWNER_VIEWS: Record<string, readonly Surface[]> = {
  Calendar: ['calendar', 'integrations', 'trips'],
  Employment: ['employment'],
  Finance: ['finance'],
  Health: ['health'],
  Inventory: ['inventory'],
  Knowledge: ['knowledge'],
  Projects: ['projects', 'tasks', 'secrets', 'inventory'],
  Trips: ['trips'],
  Integrations: ['integrations'],
};

export function useDomainDemand(source: string): boolean {
  const shell = useContext(ShellContext);
  const overlays = useContext(ViewDataDemandCtx);
  const views = OWNER_VIEWS[source];
  // Standalone provider tests and shared providers have no view restriction.
  return !shell || !views || views.includes(shell.surface)
    || Object.values(overlays?.consumers ?? {}).some(domains => domains.includes(source));
}
