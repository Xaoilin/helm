import type { Surface } from '../types/domain';

// Prayer reminder receipts remain available on every page. Custom providers hydrate each listed
// group together. Calendar data comes from the calendar service; settings and integrations from the
// profile service; trips, inventory, jobs and health from the life admin service; knowledge, lifestyle
// and projects from the knowledge service; tasks, progress and the clock from the planner service; finance
// (accounts, transactions, budgets, savings goals, the banking review and equity) from the finance service.
export const SHARED_PAGE_COLLECTIONS = [
  'prayerTracking',
] as const;

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
  finance: [],
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
