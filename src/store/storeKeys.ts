export interface SharedStoreKey {
  key: string;
  label: string;
  description: string;
}

export const SHARED_STORE_KEYS = [
  { key: 'calendarAccounts', label: 'Calendar accounts', description: 'Calendar account records.' },
  { key: 'calendarSources', label: 'Calendar sources', description: 'Calendars and source visibility.' },
  { key: 'calendarEvents', label: 'Calendar events', description: 'Local and synced calendar events.' },
  { key: 'clock', label: 'Clock workspace', description: 'Timers and stopwatches.' },
  { key: 'projects', label: 'Projects', description: 'Project portfolio records.' },
  { key: 'projectPages', label: 'Project pages', description: 'Project wiki pages.' },
  { key: 'tasks', label: 'Tasks', description: 'Tasks, habits, goals, and board state.' },
  { key: 'dashboardFocusFeedback', label: 'Dashboard focus feedback', description: 'Up Next feedback history.' },
  { key: 'knowledgeTopics', label: 'Knowledge topics', description: 'Knowledge base topic taxonomy.' },
  { key: 'knowledgeEntries', label: 'Knowledge entries', description: 'Knowledge base notes.' },
  { key: 'lifestyleItems', label: 'Lifestyle tracker', description: 'Lifestyle tracker items.' },
  { key: 'financeReviews', label: 'Banking review and loans', description: 'Dated private spending, monthly budgets, and loan records.' },
  { key: 'equityPositions', label: 'Stocks and options', description: 'Private holdings, grants, plans, and dated equity scenarios.' },
  { key: 'financeAccounts', label: 'Finance accounts', description: 'Finance account records.' },
  { key: 'transactions', label: 'Transactions', description: 'Finance transaction ledger.' },
  { key: 'financeBudgets', label: 'Finance budgets', description: 'Budget records.' },
  { key: 'savingsGoals', label: 'Savings goals', description: 'Savings goal records.' },
  { key: 'gamification', label: 'Profile progress', description: 'XP, streak, and achievement progress.' },
  { key: 'prayerTracking', label: 'Prayer outcomes', description: 'Classified prayer outcomes and reminder receipts.' },
] as const satisfies SharedStoreKey[];

export const SHARED_STORE_KEY_SET = new Set<string>(SHARED_STORE_KEYS.map(item => item.key));

/**
 * Decode-only compatibility. These collections are never imported, exported, or written. Settings
 * and integrations moved to the profile service; trips, inventory, the job tracker and the fast-food
 * journal to the life admin service; `conversations`, `assistantCorrections` and
 * `assistantActivityLog` belonged to the removed Lina assistant.
 */
export const LEGACY_SHARED_STORE_KEY_SET = new Set<string>([
  'captureItems', 'settings', 'integrations', 'conversations', 'assistantCorrections', 'assistantActivityLog',
  'trips', 'tripLegs', 'tripItineraryItems', 'tripBookings', 'tripBudgetEntries',
  'inventoryItems', 'inventoryNeeds', 'employment', 'healthFastFoodEntries',
]);

export const KNOWN_SHARED_STORE_KEY_SET = new Set<string>([
  ...SHARED_STORE_KEY_SET,
  ...LEGACY_SHARED_STORE_KEY_SET,
]);

export function getSharedStoreKey(key: string): SharedStoreKey | null {
  return SHARED_STORE_KEYS.find(item => item.key === key) ?? null;
}
