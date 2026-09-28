/**
 * Which live-update domains (a service write command's prefix, such as `lifestyle` in
 * `lifestyle.save-item`) each part of the app reloads on.
 */
export const LIVE_DOMAINS = {
  employment: ['jobs'],
  health: ['health'],
  inventory: ['inventory'],
  knowledge: ['knowledge', 'lifestyle'],
  trips: ['trips'],
  projects: ['projects'],
  calendar: ['calendar'],
  prayer: ['prayer'],
  profile: ['profile'],
  tasks: ['tasks', 'rewards'],
  gamification: ['tasks', 'rewards', 'gamification'],
  momentum: ['momentum'],
  clock: ['clock'],
  finance: ['finance'],
  equity: ['equity'],
} as const satisfies Record<string, readonly string[]>;
