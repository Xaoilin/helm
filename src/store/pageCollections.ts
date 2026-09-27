import type { Surface } from '../types/domain';

// Background reminders, rewards and running timers remain available on every page. Custom
// providers hydrate each listed group together. Calendar data comes from the calendar service;
// settings and integrations from the profile service; trips, inventory, jobs and health from the
// life admin service; knowledge, lifestyle and projects from the knowledge service.
export const SHARED_PAGE_COLLECTIONS = [
  'gamification', 'tasks', 'prayerTracking', 'clock',
] as const;

const FINANCE_COLLECTIONS = ['financeAccounts', 'transactions', 'financeBudgets', 'savingsGoals'];

const PAGE_COLLECTIONS: Record<Surface, readonly string[]> = {
  dashboard: [],
  calendar: [],
  clock: [],
  trips: [],
  projects: [],
  tasks: [],
  inventory: [],
  secrets: [],
  employment: [],
  finance: [...FINANCE_COLLECTIONS, 'financeReviews', 'equityPositions'],
  health: [],
  knowledge: [],
  profile: [],
  integrations: [],
  activity: [],
  settings: [],
  debug: [],
};

export function getPageCollections(surface: Surface): readonly string[] {
  return [...new Set([...SHARED_PAGE_COLLECTIONS, ...PAGE_COLLECTIONS[surface]])];
}
