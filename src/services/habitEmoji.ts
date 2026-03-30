/** Default emoji mapping based on habit title keywords. */
const KEYWORD_EMOJI: [string[], string][] = [
  [['exercise', 'gym', 'workout', 'lift', 'run', 'jog', 'fitness'], '\u{1F4AA}'],
  [['read', 'book', 'study', 'learn'], '\u{1F4D6}'],
  [['meditat', 'mindful', 'breath', 'calm'], '\u{1F9D8}'],
  [['code', 'program', 'dev', 'hack', 'build'], '\u{1F4BB}'],
  [['write', 'journal', 'blog', 'note'], '\u{270D}\uFE0F'],
  [['water', 'drink', 'hydrat'], '\u{1F4A7}'],
  [['sleep', 'bed', 'rest', 'nap'], '\u{1F634}'],
  [['eat', 'food', 'cook', 'meal', 'diet', 'nutrition'], '\u{1F957}'],
  [['walk', 'step', 'move'], '\u{1F6B6}'],
  [['clean', 'tidy', 'organiz'], '\u{1F9F9}'],
  [['pray', 'islam', 'quran', 'salah', 'dua'], '\u{1F54C}'],
  [['stretch', 'yoga', 'flex'], '\u{1F9D8}'],
  [['vitamin', 'supplement', 'medicine', 'pill'], '\u{1F48A}'],
  [['call', 'phone', 'contact', 'email'], '\u{1F4DE}'],
  [['plan', 'review', 'reflect'], '\u{1F4DD}'],
  [['music', 'practice', 'instrument', 'guitar', 'piano'], '\u{1F3B5}'],
  [['language', 'arabic', 'spanish', 'french', 'duolingo'], '\u{1F30D}'],
  [['standup', 'meeting', 'sync'], '\u{1F4E2}'],
  [['ship', 'deploy', 'release', 'push'], '\u{1F680}'],
  [['test', 'qa', 'check'], '\u2705'],
];

const DEFAULT_EMOJI = '\u{2B50}'; // star

export function getHabitEmoji(title: string, customEmoji?: string): string {
  if (customEmoji) return customEmoji;
  const lower = title.toLowerCase();
  for (const [keywords, emoji] of KEYWORD_EMOJI) {
    if (keywords.some(kw => lower.includes(kw))) return emoji;
  }
  return DEFAULT_EMOJI;
}

/** Preset emoji palette for the picker. */
export const EMOJI_PALETTE = [
  '\u{1F4AA}', '\u{1F4D6}', '\u{1F9D8}', '\u{1F4BB}', '\u{270D}\uFE0F',
  '\u{1F4A7}', '\u{1F634}', '\u{1F957}', '\u{1F6B6}', '\u{1F9F9}',
  '\u{1F54C}', '\u{1F48A}', '\u{1F4DE}', '\u{1F4DD}', '\u{1F3B5}',
  '\u{1F30D}', '\u{1F4E2}', '\u{1F680}', '\u2705', '\u{2B50}',
  '\u{1F525}', '\u{1F3AF}', '\u{1F9E0}', '\u{2764}\uFE0F', '\u{1F31F}',
  '\u{1F3C3}', '\u{1F6E1}', '\u{26A1}', '\u{1F48E}', '\u{1F3C6}',
];
