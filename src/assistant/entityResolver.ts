import type {
  CalendarEvent,
  CalendarSource,
  FinanceAccount,
  KnowledgeTopic,
  Project,
  Surface,
  Task,
} from '../types/domain';
import type {
  AssistantCommandContext,
  AssistantDialogState,
  AssistantEntityKind,
  AssistantEntityReference,
} from './shared';

export const SURFACE_KEYWORDS: Record<Surface, string[]> = {
  dashboard: ['dashboard', 'home', 'main', 'لوحة', 'الرئيسية'],
  chat: ['chat', 'conversation', 'message', 'messages', 'محادثة', 'رسالة'],
  calendar: ['calendar', 'schedule', 'meetings', 'events', 'تقويم', 'اجتماع', 'مواعيد'],
  clock: ['clock', 'timer', 'stopwatch', 'countdown', 'timers', 'ساعة', 'مؤقت', 'عداد'],
  trips: ['trip', 'trips', 'travel', 'itinerary', 'journey', 'vacation', 'travel planner', 'رحلة', 'رحلات', 'سفر'],
  projects: ['project', 'projects', 'portfolio', 'board', 'wiki', 'kanban', 'مشاريع', 'مشروع'],
  inventory: ['inventory', 'stock', 'tools', 'equipment', 'materials', 'workshop', 'مخزون', 'أدوات'],
  secrets: ['secret', 'secrets', 'password', 'passwords', 'credential', 'credentials', 'vault', 'كلمة مرور', 'أسرار'],
  tasks: ['task', 'tasks', 'todo', 'to do', 'habits', 'مهام', 'مهمة', 'عادات'],
  health: ['health', 'wellbeing', 'wellness', 'food log', 'fast food', 'health log', 'صحة', 'عافية'],
  knowledge: ['knowledge', 'islam', 'quran', 'learn', 'معرفة', 'إسلام', 'قرآن'],
  profile: ['profile', 'stats', 'achievements', 'badges', 'level', 'ملف', 'إنجازات', 'مستوى'],
  integrations: ['integration', 'integrations', 'connect', 'ربط', 'تكامل'],
  activity: ['activity', 'activity log', 'audit', 'audit log', 'undo', 'actions', 'سجل'],
  settings: ['setting', 'settings', 'preferences', 'config', 'إعدادات', 'تفضيلات'],
  finance: ['finance', 'money', 'budget', 'مالية', 'ميزانية', 'فلوس'],
  debug: ['debug', 'diagnostics', 'logs', 'تشخيص'],
};

export const SURFACE_LABELS: Record<Surface, { en: string; ar: string }> = {
  dashboard: { en: 'Dashboard', ar: 'لوحة التحكم' },
  chat: { en: 'Chat', ar: 'المحادثة' },
  calendar: { en: 'Calendar', ar: 'التقويم' },
  clock: { en: 'Clock', ar: 'الساعة' },
  trips: { en: 'Trips', ar: 'الرحلات' },
  projects: { en: 'Projects', ar: 'المشاريع' },
  inventory: { en: 'Inventory', ar: 'المخزون' },
  secrets: { en: 'Secrets', ar: 'الأسرار' },
  tasks: { en: 'Tasks', ar: 'المهام' },
  health: { en: 'Health', ar: 'الصحة' },
  knowledge: { en: 'Knowledge', ar: 'المعرفة' },
  profile: { en: 'Profile', ar: 'الملف الشخصي' },
  integrations: { en: 'Integrations', ar: 'التكاملات' },
  activity: { en: 'Activity', ar: 'سجل النشاط' },
  settings: { en: 'Settings', ar: 'الإعدادات' },
  finance: { en: 'Finance', ar: 'المالية' },
  debug: { en: 'Debug', ar: 'التشخيص' },
};

export interface ResolvedEntity<T> extends AssistantEntityReference {
  data: T;
  score: number;
}

export interface EntityResolution<T> {
  best: ResolvedEntity<T> | null;
  matches: ResolvedEntity<T>[];
  ambiguous: boolean;
}

function normaliseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenise(value: string): string[] {
  return normaliseText(value).split(' ').filter(Boolean);
}

function normaliseTokenRoot(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 4 && !token.endsWith('ses')) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function computeStringScore(query: string, candidate: string): number {
  const normalisedQuery = normaliseText(query);
  const normalisedCandidate = normaliseText(candidate);
  if (!normalisedQuery || !normalisedCandidate) return 0;

  if (normalisedQuery === normalisedCandidate) return 1;
  if (normalisedCandidate.startsWith(normalisedQuery) || normalisedQuery.startsWith(normalisedCandidate)) return 0.9;
  if (normalisedCandidate.includes(normalisedQuery) || normalisedQuery.includes(normalisedCandidate)) return 0.82;

  const queryTokens = tokenise(normalisedQuery);
  const candidateTokens = tokenise(normalisedCandidate);
  const queryRoots = queryTokens.map(normaliseTokenRoot);
  const candidateRoots = candidateTokens.map(normaliseTokenRoot);
  const overlap = queryRoots.filter(token => candidateRoots.includes(token)).length;
  if (overlap === 0) return 0;
  if (overlap === queryRoots.length) return 0.72;

  return Math.min(0.78, overlap / Math.max(queryRoots.length, candidateRoots.length) + 0.35);
}

function recencyBonus(
  kind: AssistantEntityKind,
  id: string,
  dialogState: AssistantDialogState | undefined,
): number {
  const recent = dialogState?.recentEntities.find(entity => entity.kind === kind && entity.id === id);
  return recent ? 0.12 : 0;
}

function surfaceBias(kind: AssistantEntityKind, currentSurface: Surface | undefined): number {
  if (!currentSurface) return 0;
  if (kind === 'task' && currentSurface === 'tasks') return 0.08;
  if ((kind === 'calendar_event' || kind === 'calendar_source' || kind === 'calendar_account') && currentSurface === 'calendar') return 0.08;
  if (kind === 'finance_account' && currentSurface === 'finance') return 0.08;
  if ((kind === 'knowledge_entry' || kind === 'knowledge_topic') && currentSurface === 'knowledge') return 0.08;
  if (kind === 'project' && currentSurface === 'projects') return 0.08;
  return 0;
}

function pronounTargets(query: string): boolean {
  const value = normaliseText(query);
  return ['it', 'that', 'that one', 'this', 'this one', 'the one', 'one', 'that task', 'that event'].includes(value);
}

function buildResolution<T>(matches: ResolvedEntity<T>[]): EntityResolution<T> {
  const sorted = [...matches].sort((a, b) => b.score - a.score);
  const best = sorted[0] ?? null;
  const ambiguous = Boolean(best && sorted[1] && best.score - sorted[1].score < 0.08);
  return { best, matches: sorted, ambiguous };
}

function recentEntityByKind<T>(
  kind: AssistantEntityKind,
  dialogState: AssistantDialogState | undefined,
  materialise: (reference: AssistantEntityReference) => T | undefined,
): EntityResolution<T> {
  const recent = dialogState?.recentEntities.find(entity => entity.kind === kind);
  if (!recent) return { best: null, matches: [], ambiguous: false };
  const data = materialise(recent);
  if (!data) return { best: null, matches: [], ambiguous: false };
  return {
    best: { ...recent, data, score: 1 },
    matches: [{ ...recent, data, score: 1 }],
    ambiguous: false,
  };
}

function formatEventAliases(event: CalendarEvent): string[] {
  if (event.allDay) return [];
  const start = new Date(event.start);
  const hour12 = start.toLocaleTimeString('en-GB', { hour: 'numeric', hour12: true }).toLowerCase();
  const hourMinute12 = start.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  const hour24 = start.toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false });
  const hourMinute24 = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return [hour12, hourMinute12, hour24, hourMinute24].map(alias => alias.replace(/\s/g, ''));
}

function scoreEntity(
  query: string,
  candidateTexts: string[],
  kind: AssistantEntityKind,
  id: string,
  dialogState: AssistantDialogState | undefined,
  currentSurface: Surface | undefined,
): number {
  const base = Math.max(...candidateTexts.map(text => computeStringScore(query, text)));
  if (base === 0) return 0;
  return Math.min(1, base + recencyBonus(kind, id, dialogState) + surfaceBias(kind, currentSurface));
}

export function makeEntityReference(
  kind: AssistantEntityKind,
  id: string,
  label: string,
  surface: Surface | undefined,
  score: number,
): AssistantEntityReference {
  return {
    kind,
    id,
    label,
    surface,
    score,
    lastUsedAt: new Date().toISOString(),
  };
}

export function resolveSurfaceReference(
  query: string,
  dialogState?: AssistantDialogState,
): EntityResolution<Surface> {
  if (pronounTargets(query) && dialogState?.currentSurface) {
    const surface = dialogState.currentSurface;
    return {
      best: {
        ...makeEntityReference('surface', surface, surface, surface, 1),
        data: surface,
        score: 1,
      },
      matches: [{
        ...makeEntityReference('surface', surface, surface, surface, 1),
        data: surface,
        score: 1,
      }],
      ambiguous: false,
    };
  }

  const matches = (Object.keys(SURFACE_KEYWORDS) as Surface[])
    .map(surface => {
      const score = scoreEntity(query, [surface, ...SURFACE_KEYWORDS[surface]], 'surface', surface, dialogState, dialogState?.currentSurface);
      if (score < 0.55) return null;
      return {
        ...makeEntityReference('surface', surface, SURFACE_LABELS[surface].en, surface, score),
        data: surface,
        score,
      };
    })
    .filter((match): match is ResolvedEntity<Surface> => match !== null);

  return buildResolution(matches);
}

export function resolveTaskReference(
  query: string,
  context: AssistantCommandContext,
  dialogState?: AssistantDialogState,
  opts: { category?: Task['category'] | 'any'; allowCompleted?: boolean } = {},
): EntityResolution<Task> {
  if (pronounTargets(query)) {
    return recentEntityByKind('task', dialogState, reference =>
      context.tasks.find(task => task.id === reference.id),
    );
  }

  const matches = context.tasks
    .filter(task => (opts.allowCompleted ? true : !task.completed))
    .filter(task => (opts.category && opts.category !== 'any' ? task.category === opts.category : true))
    .map(task => {
      const score = scoreEntity(query, [task.title, task.description, task.emoji || ''], 'task', task.id, dialogState, context.currentSurface);
      if (score < 0.55) return null;
      return {
        ...makeEntityReference('task', task.id, task.title, 'tasks', score),
        data: task,
        score,
      };
    })
    .filter((match): match is ResolvedEntity<Task> => match !== null);

  return buildResolution(matches);
}

export function resolveProjectReference(
  query: string,
  context: AssistantCommandContext,
  dialogState?: AssistantDialogState,
): EntityResolution<Project> {
  if (pronounTargets(query)) {
    return recentEntityByKind('project', dialogState, reference =>
      context.projects.find(project => project.id === reference.id),
    );
  }

  const matches = context.projects
    .map(project => {
      const score = scoreEntity(
        query,
        [project.name, project.summary, ...project.tags],
        'project',
        project.id,
        dialogState,
        context.currentSurface,
      );
      if (score < 0.55) return null;
      return {
        ...makeEntityReference('project', project.id, project.name, 'projects', score),
        data: project,
        score,
      };
    })
    .filter((match): match is ResolvedEntity<Project> => match !== null);

  return buildResolution(matches);
}

export function resolveCalendarEventReference(
  query: string,
  context: AssistantCommandContext,
  dialogState?: AssistantDialogState,
): EntityResolution<CalendarEvent> {
  if (pronounTargets(query)) {
    return recentEntityByKind('calendar_event', dialogState, reference =>
      context.calendarEvents.find(event => event.id === reference.id),
    );
  }

  const matches = context.calendarEvents
    .map(event => {
      const aliases = formatEventAliases(event);
      const source = context.calendarSources.find(item => item.id === event.sourceId);
      const account = source ? context.calendarAccounts.find(item => item.id === source.accountId) : undefined;
      const score = scoreEntity(
        query,
        [event.title, event.location || '', event.description, ...aliases, source?.name || '', account?.name || '', account?.email || ''],
        'calendar_event',
        event.id,
        dialogState,
        context.currentSurface,
      );
      if (score < 0.5) return null;
      return {
        ...makeEntityReference('calendar_event', event.id, event.title, 'calendar', score),
        data: event,
        score,
      };
    })
    .filter((match): match is ResolvedEntity<CalendarEvent> => match !== null);

  return buildResolution(matches);
}

export function resolveCalendarSourceReference(
  query: string,
  context: AssistantCommandContext,
  dialogState?: AssistantDialogState,
): EntityResolution<CalendarSource> {
  const matches = context.calendarSources
    .map(source => {
      const account = context.calendarAccounts.find(item => item.id === source.accountId);
      const score = scoreEntity(
        query,
        [source.name, `${source.name} calendar`, account?.name || '', account?.email || ''],
        'calendar_source',
        source.id,
        dialogState,
        context.currentSurface,
      );
      if (score < 0.52) return null;
      return {
        ...makeEntityReference('calendar_source', source.id, source.name, 'calendar', score),
        data: source,
        score,
      };
    })
    .filter((match): match is ResolvedEntity<CalendarSource> => match !== null);

  return buildResolution(matches);
}

export function resolveFinanceAccountReference(
  query: string,
  context: AssistantCommandContext,
  dialogState?: AssistantDialogState,
): EntityResolution<FinanceAccount> {
  const matches = context.financeAccounts
    .map(account => {
      const score = scoreEntity(query, [account.name, account.type, account.currency], 'finance_account', account.id, dialogState, context.currentSurface);
      if (score < 0.55) return null;
      return {
        ...makeEntityReference('finance_account', account.id, account.name, 'finance', score),
        data: account,
        score,
      };
    })
    .filter((match): match is ResolvedEntity<FinanceAccount> => match !== null);

  return buildResolution(matches);
}

export function resolveKnowledgeTopicReference(
  query: string,
  context: AssistantCommandContext,
  dialogState?: AssistantDialogState,
): EntityResolution<KnowledgeTopic> {
  const matches = context.knowledgeTopics
    .map(topic => {
      const score = scoreEntity(query, [topic.name, topic.description], 'knowledge_topic', topic.id, dialogState, context.currentSurface);
      if (score < 0.55) return null;
      return {
        ...makeEntityReference('knowledge_topic', topic.id, topic.name, 'knowledge', score),
        data: topic,
        score,
      };
    })
    .filter((match): match is ResolvedEntity<KnowledgeTopic> => match !== null);

  return buildResolution(matches);
}
