import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import { CHAT, VOICE_SESSION } from '../../config/constants';
import type {
  AssistantCorrection,
  AssistantMessageBilling,
  ChatConversation,
  ChatMessage,
  CalendarAccount,
  CalendarEvent,
  CalendarSource,
  FinanceAccount,
  GamificationProfile,
  KnowledgeEntry,
  KnowledgeTopic,
  LifestyleItem,
  Project,
  Settings,
  Task,
  Transaction,
} from '../../types/domain';
import { loadStore, saveStore } from '../persistence';
import { processAssistantCommand } from '../../services/assistantRuntime';
import { buildProviderOnlyAssistantBilling } from '../../services/assistantBilling';
import type { AssistantConversationMessage, AssistantDialogState } from '../../services/assistantTypes';

interface CreateConversationOptions {
  title?: string;
  initialMessages?: Array<Pick<ChatMessage, 'role' | 'content'>>;
  dialogState?: AssistantDialogState;
}

export interface ChatCrossDomainData {
  calendarAccounts: CalendarAccount[];
  calendarSources: CalendarSource[];
  calendarEvents: CalendarEvent[];
  projects: Project[];
  tasks: Task[];
  financeAccounts: FinanceAccount[];
  transactions: Transaction[];
  knowledgeEntries: KnowledgeEntry[];
  knowledgeTopics: KnowledgeTopic[];
  lifestyleItems: LifestyleItem[];
  assistantCorrections: AssistantCorrection[];
  gamification: GamificationProfile;
  settings: Settings;
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
  upsertAssistantCorrection: (correction: {
    sourceText: string;
    targetText: string;
    lang: 'en' | 'ar';
    scope: AssistantCorrection['scope'];
  }) => string | null;
  noteAssistantCorrectionApplied: (id: string) => void;
  addCalendarEvent: (event: Omit<CalendarEvent, 'id'>) => string;
  updateCalendarEvent: (id: string, updates: Partial<CalendarEvent>) => void;
  addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => string;
  addKnowledgeEntry: (entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateGamification: (profile: GamificationProfile) => void;
}

export interface ChatContextValue {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  loaded: boolean;
  createConversation: (options?: CreateConversationOptions) => string;
  setActiveConversation: (id: string | null) => void;
  sendMessage: (conversationId: string, content: string) => Promise<void>;
  recordAssistantConversationTurn: (
    conversationId: string,
    turn: {
      userContent: string;
      assistantContent: string;
      assistantBilling?: AssistantMessageBilling;
      dialogState?: AssistantDialogState;
    },
  ) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
}

const ChatCtx = createContext<ChatContextValue | null>(null);

function buildChatMessage(
  role: ChatMessage['role'],
  content: string,
  timestamp: string = new Date().toISOString(),
  assistantBilling?: AssistantMessageBilling,
): ChatMessage {
  return {
    id: uuid(),
    role,
    content,
    timestamp,
    ...(assistantBilling ? { assistantBilling } : {}),
  };
}

function getConversationTitleFromMessages(
  messages: Array<Pick<ChatMessage, 'role' | 'content'>>,
  fallbackTitle: string = CHAT.DEFAULT_CONVERSATION_TITLE,
): string {
  const firstUserMessage = messages.find(message => message.role === 'user' && message.content.trim());
  if (firstUserMessage) {
    return firstUserMessage.content.trim().slice(0, 50);
  }

  return fallbackTitle;
}

function shouldAutoRenameConversation(conversation: ChatConversation): boolean {
  return conversation.messages.length === 0
    || conversation.title === CHAT.DEFAULT_CONVERSATION_TITLE
    || conversation.title === VOICE_SESSION.CONVERSATION_TITLE;
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatCtx);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}

interface ChatProviderProps {
  children: ReactNode;
  crossDomain: ChatCrossDomainData;
}

export function ChatProvider({ children, crossDomain }: ChatProviderProps) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationIdState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const conversationsRef = useRef<ChatConversation[]>([]);
  const dialogStatesRef = useRef<Record<string, AssistantDialogState>>({});

  useEffect(() => {
    (async () => {
      const data = await loadStore<ChatConversation[]>('conversations');
      setConversations(data ?? []);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) saveStore('conversations', conversations); }, [conversations, loaded]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  const createConversation = useCallback((options?: CreateConversationOptions): string => {
    const id = uuid();
    const now = new Date().toISOString();
    const initialMessages = (options?.initialMessages || []).map((message, index) =>
      buildChatMessage(message.role, message.content, new Date(new Date(now).getTime() + index).toISOString())
    );
    const conversation: ChatConversation = {
      id,
      title: options?.title || getConversationTitleFromMessages(initialMessages, CHAT.DEFAULT_CONVERSATION_TITLE),
      messages: initialMessages,
      createdAt: now,
      updatedAt: now,
    };

    dialogStatesRef.current[id] = options?.dialogState || {
      currentSurface: 'chat',
      recentEntities: [],
      recentPlans: [],
    };

    setConversations(prev => [conversation, ...prev]);
    setActiveConversationIdState(id);
    return id;
  }, []);

  const setActiveConversation = useCallback((id: string | null) => {
    setActiveConversationIdState(id);
  }, []);

  const sendMessage = useCallback(async (conversationId: string, content: string) => {
    const now = new Date().toISOString();
    const userMessage = buildChatMessage('user', content, now);
    const existingConversation = conversationsRef.current.find(conversation => conversation.id === conversationId);
    const history: AssistantConversationMessage[] = (existingConversation?.messages || []).slice(-10).map(message => ({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    }));

    setConversations(prev => {
      const exists = prev.some(conversation => conversation.id === conversationId);
      if (!exists) {
        const newConversation: ChatConversation = {
          id: conversationId,
          title: content.slice(0, 50),
          messages: [userMessage],
          createdAt: now,
          updatedAt: now,
        };
        return [newConversation, ...prev];
      }

      return prev.map(conversation =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: [...conversation.messages, userMessage],
              title: shouldAutoRenameConversation(conversation) ? content.slice(0, 50) : conversation.title,
              updatedAt: now,
            }
          : conversation
      );
    });
    setActiveConversationIdState(conversationId);

    const dialogState = dialogStatesRef.current[conversationId];
    const result = await processAssistantCommand(content, {
      calendarAccounts: crossDomain.calendarAccounts,
      calendarSources: crossDomain.calendarSources,
      calendarEvents: crossDomain.calendarEvents,
      projects: crossDomain.projects,
      tasks: crossDomain.tasks,
      financeAccounts: crossDomain.financeAccounts,
      transactions: crossDomain.transactions,
      knowledgeEntries: crossDomain.knowledgeEntries,
      knowledgeTopics: crossDomain.knowledgeTopics,
      lifestyleItems: crossDomain.lifestyleItems,
      gamification: crossDomain.gamification,
      goalTags: crossDomain.settings.goalTags,
      currentSurface: 'chat',
    }, {
      lang: crossDomain.settings.assistantLanguage || 'en',
      conversationHistory: history,
      corrections: crossDomain.assistantCorrections,
      dialogState,
      provider: crossDomain.settings.assistantProvider,
      hostedModel: crossDomain.settings.hostedModel,
      endpoint: crossDomain.settings.ollamaEndpoint,
      ollamaModel: crossDomain.settings.ollamaModel,
      handlers: {
        addTask: crossDomain.addTask,
        updateTask: crossDomain.updateTask,
        removeTask: crossDomain.removeTask,
        upsertAssistantCorrection: crossDomain.upsertAssistantCorrection,
        noteAssistantCorrectionApplied: crossDomain.noteAssistantCorrectionApplied,
        addCalendarEvent: crossDomain.addCalendarEvent,
        updateCalendarEvent: crossDomain.updateCalendarEvent,
        addTransaction: crossDomain.addTransaction,
        addKnowledgeEntry: crossDomain.addKnowledgeEntry,
        updateGamification: crossDomain.updateGamification,
      },
    });

    dialogStatesRef.current[conversationId] = result.dialogState;

    const assistantMessage = buildChatMessage(
      'assistant',
      result.assistantMessage,
      new Date().toISOString(),
      result.assistantBilling || buildProviderOnlyAssistantBilling(result.source, result.planningModel),
    );

    setConversations(prev =>
      prev.map(conversation =>
        conversation.id === conversationId
          ? { ...conversation, messages: [...conversation.messages, assistantMessage], updatedAt: new Date().toISOString() }
          : conversation
      )
    );
  }, [crossDomain]);

  const recordAssistantConversationTurn = useCallback((
    conversationId: string,
    turn: {
      userContent: string;
      assistantContent: string;
      assistantBilling?: AssistantMessageBilling;
      dialogState?: AssistantDialogState;
    },
  ) => {
    const now = new Date().toISOString();
    const userMessage = buildChatMessage('user', turn.userContent, now);
    const assistantMessage = buildChatMessage(
      'assistant',
      turn.assistantContent,
      new Date().toISOString(),
      turn.assistantBilling,
    );

    dialogStatesRef.current[conversationId] = turn.dialogState || dialogStatesRef.current[conversationId] || {
      currentSurface: 'chat',
      recentEntities: [],
      recentPlans: [],
    };

    setConversations(prev => {
      const exists = prev.some(conversation => conversation.id === conversationId);
      if (!exists) {
        const newConversation: ChatConversation = {
          id: conversationId,
          title: turn.userContent.slice(0, 50) || CHAT.DEFAULT_CONVERSATION_TITLE,
          messages: [userMessage, assistantMessage],
          createdAt: now,
          updatedAt: new Date().toISOString(),
        };

        return [newConversation, ...prev];
      }

      return prev.map(conversation =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: [...conversation.messages, userMessage, assistantMessage],
              title: shouldAutoRenameConversation(conversation) ? turn.userContent.slice(0, 50) || conversation.title : conversation.title,
              updatedAt: new Date().toISOString(),
            }
          : conversation
      );
    });

    setActiveConversationIdState(conversationId);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => prev.filter(conversation => conversation.id !== id));
    setActiveConversationIdState(prev => prev === id ? null : prev);
    delete dialogStatesRef.current[id];
  }, []);

  const renameConversation = useCallback((id: string, title: string) => {
    setConversations(prev => prev.map(conversation => conversation.id === id ? { ...conversation, title } : conversation));
  }, []);

  const value: ChatContextValue = {
    conversations,
    activeConversationId,
    loaded,
    createConversation,
    setActiveConversation,
    sendMessage,
    recordAssistantConversationTurn,
    deleteConversation,
    renameConversation,
  };

  return <ChatCtx.Provider value={value}>{children}</ChatCtx.Provider>;
}
