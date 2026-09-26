import type { Surface } from '../types/domain';

// Background reminders, rewards and running timers remain available on every page. Custom
// providers hydrate each listed group together. Calendar data comes from the calendar service;
// settings and integrations from the profile service.
export const SHARED_PAGE_COLLECTIONS = [
  'gamification', 'tasks', 'prayerTracking',
  'knowledgeTopics', 'knowledgeEntries', 'lifestyleItems', 'clock',
] as const;

const PROJECT_COLLECTIONS = ['projects', 'projectPages', 'workspaces'];
const FINANCE_COLLECTIONS = ['financeAccounts', 'transactions', 'financeBudgets', 'savingsGoals'];
const INVENTORY_COLLECTIONS = ['inventoryItems', 'inventoryNeeds'];

const PAGE_COLLECTIONS: Record<Surface, readonly string[]> = {
  dashboard: [],
  calendar: [],
  clock: [],
  trips: ['trips', 'tripLegs', 'tripItineraryItems', 'tripBookings', 'tripBudgetEntries'],
  projects: PROJECT_COLLECTIONS,
  tasks: PROJECT_COLLECTIONS,
  inventory: [...PROJECT_COLLECTIONS, ...INVENTORY_COLLECTIONS],
  secrets: PROJECT_COLLECTIONS,
  employment: ['employment'],
  finance: [...FINANCE_COLLECTIONS, 'financeReviews', 'equityPositions'],
  health: ['healthFastFoodEntries'],
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
