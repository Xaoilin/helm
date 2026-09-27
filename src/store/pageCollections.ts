import type { Surface } from '../types/domain';

// Collections every page needs; custom providers hydrate each listed group together. None is left:
// calendar data comes from the calendar service; settings and integrations from the profile service;
// trips, inventory, jobs and health from the life admin service; knowledge, lifestyle and projects from
// the knowledge service; tasks, progress and the clock from the planner service; prayer outcomes and
// reminders from the prayer service.
export const SHARED_PAGE_COLLECTIONS: readonly string[] = [];

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
