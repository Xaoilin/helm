export interface SharedStoreKey {
  key: string;
  label: string;
  description: string;
}

export const SHARED_STORE_KEYS = [
  { key: 'settings', label: 'Settings', description: 'Theme, assistant, voice, and provider settings.' },
  { key: 'integrations', label: 'Integrations', description: 'Integration connection status and metadata.' },
  { key: 'conversations', label: 'Chat conversations', description: 'Saved Lina chat threads.' },
  { key: 'calendarAccounts', label: 'Calendar accounts', description: 'Calendar account records.' },
  { key: 'calendarSources', label: 'Calendar sources', description: 'Calendars and source visibility.' },
  { key: 'calendarEvents', label: 'Calendar events', description: 'Local and synced calendar events.' },
  { key: 'clock', label: 'Clock workspace', description: 'Timers and stopwatches.' },
  { key: 'trips', label: 'Trips', description: 'Trip records.' },
  { key: 'tripLegs', label: 'Trip legs', description: 'Trip destination legs.' },
  { key: 'tripItineraryItems', label: 'Trip itinerary', description: 'Trip itinerary items.' },
  { key: 'tripBookings', label: 'Trip bookings', description: 'Transport and stay bookings.' },
  { key: 'tripBudgetEntries', label: 'Trip budget', description: 'Trip budget ledger entries.' },
  { key: 'projects', label: 'Projects', description: 'Project portfolio records.' },
  { key: 'projectPages', label: 'Project pages', description: 'Project wiki pages.' },
  { key: 'inventoryItems', label: 'Inventory items', description: 'Owned tools, equipment, materials, and stock.' },
  { key: 'inventoryNeeds', label: 'Inventory needs', description: 'Needed, ordered, acquired, and dismissed requirements.' },
  { key: 'tasks', label: 'Tasks', description: 'Tasks, habits, goals, and board state.' },
  { key: 'dashboardFocusFeedback', label: 'Dashboard focus feedback', description: 'Up Next feedback history.' },
  { key: 'knowledgeTopics', label: 'Knowledge topics', description: 'Knowledge base topic taxonomy.' },
  { key: 'knowledgeEntries', label: 'Knowledge entries', description: 'Knowledge base notes.' },
  { key: 'lifestyleItems', label: 'Lifestyle tracker', description: 'Lifestyle tracker items.' },
  { key: 'healthFastFoodEntries', label: 'Fast food log', description: 'Health fast-food journal entries.' },
  { key: 'financeAccounts', label: 'Finance accounts', description: 'Finance account records.' },
  { key: 'transactions', label: 'Transactions', description: 'Finance transaction ledger.' },
  { key: 'financeBudgets', label: 'Finance budgets', description: 'Budget records.' },
  { key: 'savingsGoals', label: 'Savings goals', description: 'Savings goal records.' },
  { key: 'gamification', label: 'Profile progress', description: 'XP, streak, and achievement progress.' },
  { key: 'prayerTracking', label: 'Prayer outcomes', description: 'Classified prayer outcomes and reminder receipts.' },
  { key: 'assistantCorrections', label: 'Assistant corrections', description: 'Lina transcript correction memory.' },
  { key: 'assistantActivityLog', label: 'Assistant activity', description: 'Lina action audit log.' },
] as const satisfies SharedStoreKey[];

export const SHARED_STORE_KEY_SET = new Set<string>(SHARED_STORE_KEYS.map(item => item.key));

/** Decode-only compatibility. These collections are never imported, exported, or written. */
export const LEGACY_SHARED_STORE_KEY_SET = new Set<string>(['captureItems']);

export const KNOWN_SHARED_STORE_KEY_SET = new Set<string>([
  ...SHARED_STORE_KEY_SET,
  ...LEGACY_SHARED_STORE_KEY_SET,
]);

export function getSharedStoreKey(key: string): SharedStoreKey | null {
  return SHARED_STORE_KEYS.find(item => item.key === key) ?? null;
}
