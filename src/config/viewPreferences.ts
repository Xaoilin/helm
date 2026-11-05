/** Account-saved presentation choices. Dates, drafts, searches and record IDs stay transient. */
export const VIEW_PREFERENCES = {
  "prayerChallenge.period": ["day", "week", "month"],
  "dashboard.learnIndividualSteps": ["true", "false"],
  "dashboard.moveIndividualSteps": ["true", "false"],
  "dashboard.showPrayerLog": ["true", "false"],
  "dashboard.inspirationSource": ["quran", "books", "driving"],
  "calendar.view": ["month", "week", "agenda", "accounts"],
  "tasks.tab": ["today", "all", "goals"],
  "tasks.showCompletedGoals": ["true", "false"],
  "tasks.category": ["all", "daily", "prayer", "task"],
  "tasks.priority": ["all", "low", "medium", "high"],
  "tasks.status": ["all", "active", "completed"],
  "knowledge.tab": ["browse", "add", "search", "lifestyle"],
  "knowledge.sourceFilter": ["all", "quran", "hadith", "scholarly", "other"],
  "knowledge.searchSourceFilter": ["all", "quran", "hadith", "scholarly", "other"],
  "employment.activeOnly": ["true", "false"],
  "employment.showFilters": ["true", "false"],
  "employment.status": ["all", "lead", "recruiter", "applied", "interview", "offer", "closed"],
  "employment.workType": ["all", "contract", "permanent", "unknown"],
  "employment.remoteStatus": ["all", "confirmed", "needs_verification"],
  "finance.tab": ["overview", "spending", "loans", "transactions", "accounts", "budgets", "stocks", "options"],
  "finance.filterType": ["all", "income", "expense", "transfer"],
  "inventory.view": ["owned", "needed"],
  "inventory.category": ["all", "machine", "tool", "electronics", "component", "material", "consumable", "fastener", "safety", "storage", "other"],
  "secrets.kindFilter": ["all", "password", "api_key", "access_token", "database", "private_key", "webhook", "other"],
  "secrets.showArchived": ["true", "false"],
  "trips.tab": ["overview", "timeline", "bookings", "budget"],
  "projects.tab": ["overview", "board", "milestones", "inventory", "wiki"],
  "debug.tab": ["network", "prayer", "operations"],
  "activity.rangeDays": ["7", "30", "90"],
  "activity.kind": ["all", "session", "navigation", "action", "outcome", "error", "performance"],
  "activity.surface": ["all", "dashboard", "chat", "calendar", "clock", "trips", "projects", "inventory", "secrets", "tasks", "employment", "finance", "health", "knowledge", "profile", "integrations", "activity", "settings", "debug"],
  "activity.outcome": ["all", "success", "failure", "cancelled", "unavailable"],
} as const;

export type ViewPreferenceKey = keyof typeof VIEW_PREFERENCES;

export function isViewPreference(key: string, value: string): key is ViewPreferenceKey {
  const allowed = VIEW_PREFERENCES[key as ViewPreferenceKey] as readonly string[] | undefined;
  return allowed?.includes(value) ?? false;
}
