import type { Surface } from '../types/domain';

// Background reminders, rewards, calendar sync, and running timers remain
// available on every page. Custom providers hydrate each listed group together.
export const SHARED_PAGE_COLLECTIONS = [
  'settings', 'integrations', 'gamification', 'tasks', 'prayerTracking',
  'knowledgeTopics', 'knowledgeEntries', 'lifestyleItems',
  'calendarAccounts', 'calendarSources', 'calendarEvents', 'clock',
] as const;

const PROJECT_COLLECTIONS = ['projects', 'projectPages', 'workspaces'];
const FINANCE_COLLECTIONS = ['financeAccounts', 'transactions', 'financeBudgets', 'savingsGoals'];
const INVENTORY_COLLECTIONS = ['inventoryItems', 'inventoryNeeds'];

export const ASSISTANT_PAGE_COLLECTIONS = [
  ...SHARED_PAGE_COLLECTIONS, ...PROJECT_COLLECTIONS, ...FINANCE_COLLECTIONS,
  ...INVENTORY_COLLECTIONS, 'conversations', 'assistantCorrections', 'assistantActivityLog',
] as const;

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
  activity: ['assistantActivityLog', ...FINANCE_COLLECTIONS],
  settings: [],
  debug: [],
  chat: ASSISTANT_PAGE_COLLECTIONS,
};

export function getPageCollections(surface: Surface): readonly string[] {
  return [...new Set([...SHARED_PAGE_COLLECTIONS, ...PAGE_COLLECTIONS[surface]])];
}
