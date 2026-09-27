export interface SharedStoreKey {
  key: string;
  label: string;
  description: string;
}

export const SHARED_STORE_KEYS = [
  { key: 'calendarAccounts', label: 'Calendar accounts', description: 'Calendar account records.' },
  { key: 'calendarSources', label: 'Calendar sources', description: 'Calendars and source visibility.' },
  { key: 'calendarEvents', label: 'Calendar events', description: 'Local and synced calendar events.' },
] as const satisfies SharedStoreKey[];

export const SHARED_STORE_KEY_SET = new Set<string>(SHARED_STORE_KEYS.map(item => item.key));

/**
 * Decode-only compatibility. These collections are never imported, exported, or written. Settings
 * and integrations moved to the profile service; trips, inventory, the job tracker and the fast-food
 * journal to the life admin service; the knowledge base, lifestyle tracker and projects (with their
 * pages and the older `workspaces`) to the knowledge service; tasks, progress (with daily momentum) and
 * the clock to the planner service; manual accounts, transactions, budgets, savings goals, the banking
 * review and equity positions to the finance service; `prayerTracking` (reminder receipts) to the prayer
 * service, which decides reminders; `conversations`, `assistantCorrections` and `assistantActivityLog`
 * belonged to the removed Lina assistant, and `dashboardFocusFeedback` to the removed Up Next feedback.
 */
export const LEGACY_SHARED_STORE_KEY_SET = new Set<string>([
  'captureItems', 'settings', 'integrations', 'conversations', 'assistantCorrections', 'assistantActivityLog',
  'trips', 'tripLegs', 'tripItineraryItems', 'tripBookings', 'tripBudgetEntries',
  'inventoryItems', 'inventoryNeeds', 'employment', 'healthFastFoodEntries',
  'knowledgeTopics', 'knowledgeEntries', 'lifestyleItems', 'projects', 'projectPages', 'workspaces',
  'tasks', 'gamification', 'clock', 'dashboardFocusFeedback', 'prayerTracking',
  'financeAccounts', 'transactions', 'financeBudgets', 'savingsGoals', 'financeReviews', 'equityPositions',
]);

export const KNOWN_SHARED_STORE_KEY_SET = new Set<string>([
  ...SHARED_STORE_KEY_SET,
  ...LEGACY_SHARED_STORE_KEY_SET,
]);

export function getSharedStoreKey(key: string): SharedStoreKey | null {
  return SHARED_STORE_KEYS.find(item => item.key === key) ?? null;
}
