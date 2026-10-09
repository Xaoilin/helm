import { fireEvent, render, screen } from '@testing-library/react';
import type { Context } from 'react';
import { describe, expect, it } from 'vitest';
import { PageReadinessGate } from '../store/PageReadinessGate';
import { ShellProvider, useShell } from '../store/ShellContext';
import { CalendarCtx } from '../store/contexts/CalendarContext';
import { ClockContext } from '../store/contexts/ClockContext';
import { DailyMomentumCtx } from '../store/contexts/DailyMomentumContext';
import { FinanceCtx } from '../store/contexts/FinanceContext';
import { GamificationCtx } from '../store/contexts/GamificationContext';
import { HealthContext } from '../store/contexts/HealthContext';
import { InventoryContext } from '../store/contexts/InventoryContext';
import { KnowledgeCtx } from '../store/contexts/KnowledgeContext';
import { PrayerCtx } from '../store/contexts/PrayerContext';
import { ProjectCtx } from '../store/contexts/ProjectContext';
import { SettingsCtx } from '../store/contexts/SettingsContext';
import { TaskCtx } from '../store/contexts/TaskContext';
import { TripCtx } from '../store/contexts/TripContext';
import type { Surface } from '../types/domain';
import { ContextStack, provide } from './renderWithContexts';

// The gate consumes only this typed readiness field, not the providers' data or mutations.
function readiness<T extends { loaded: boolean }>(context: Context<T | null>, loaded: boolean) {
  return provide(context, { loaded } as T);
}

function PageProbe() {
  const shell = useShell();
  return <>
    {(['dashboard', 'finance', 'calendar', 'integrations', 'clock', 'knowledge', 'trips'] as const).map(surface => (
      <button key={surface} onClick={() => shell.navigate(surface)}>{surface} navigation</button>
    ))}
    <PageReadinessGate><output>{shell.surface} data</output></PageReadinessGate>
  </>;
}

function ReadyApp({ extraLoaded = false, coreLoaded = true }) {
  return <ContextStack bindings={[
    readiness(SettingsCtx, coreLoaded), readiness(GamificationCtx, coreLoaded),
    readiness(DailyMomentumCtx, coreLoaded), readiness(TaskCtx, coreLoaded),
    readiness(PrayerCtx, coreLoaded), readiness(CalendarCtx, extraLoaded),
    readiness(ClockContext, extraLoaded), readiness(KnowledgeCtx, extraLoaded),
    readiness(ProjectCtx, extraLoaded), readiness(InventoryContext, extraLoaded),
    readiness(FinanceCtx, extraLoaded), readiness(TripCtx, extraLoaded),
    readiness(HealthContext, extraLoaded),
  ]}><ShellProvider><PageProbe /></ShellProvider></ContextStack>;
}

describe('page demand and readiness', () => {
  it('shows the dashboard while Calendar, Knowledge and Clock are still loading', () => {
    render(<ReadyApp />);
    fireEvent.click(screen.getByText('dashboard navigation'));
    expect(screen.getByText('dashboard data')).toBeVisible();
    expect(screen.queryByText('Loading page data...')).not.toBeInTheDocument();
  });

  it('renders the dashboard immediately so its sections can load independently', () => {
    render(<ReadyApp coreLoaded={false} extraLoaded />);
    fireEvent.click(screen.getByText('dashboard navigation'));
    expect(screen.getByText('dashboard data')).toBeVisible();
    expect(screen.queryByText('Loading page data...')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('finance navigation'));
    expect(screen.getByRole('status')).toHaveTextContent('Loading page data');
  });

  it.each<Surface>(['finance', 'calendar', 'integrations', 'clock', 'knowledge', 'trips'])(
    'keeps %s gated on its data and navigation available while loading', surface => {
      const view = render(<ReadyApp />);
      fireEvent.click(screen.getByText(`${surface} navigation`));
      expect(screen.getByRole('status')).toHaveTextContent('Loading page data');
      expect(screen.queryByText(`${surface} data`)).not.toBeInTheDocument();
      expect(screen.getByText('dashboard navigation')).toBeEnabled();
      view.rerender(<ReadyApp extraLoaded />);
      expect(screen.getByText(`${surface} data`)).toBeVisible();
      fireEvent.click(screen.getByText('dashboard navigation'));
      expect(screen.getByText('dashboard data')).toBeVisible();
    },
  );
});
