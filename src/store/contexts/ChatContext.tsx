import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type {
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
  Settings,
  Task,
  Transaction,
} from '../../types/domain';
import { loadStore, saveStore } from '../persistence';
import { processAssistantCommand } from '../../services/assistantRuntime';
import type { AssistantConversationMessage, AssistantDialogState } from '../../services/assistantTypes';

export interface ChatCrossDomainData {
  calendarAccounts: CalendarAccount[];
  calendarSources: CalendarSource[];
  calendarEvents: CalendarEvent[];
  tasks: Task[];
  financeAccounts: FinanceAccount[];
  transactions: Transaction[];
  knowledgeEntries: KnowledgeEntry[];
  knowledgeTopics: KnowledgeTopic[];
  lifestyleItems: LifestyleItem[];
  gamification: GamificationProfile;
  settings: Settings;
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTask: (id: string, updates: Partial<Task>) => void;
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
  createConversation: () => string;
  setActiveConversation: (id: string | null) => void;
  sendMessage: (conversationId: string, content: string) => Promise<void>;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
}

const ChatCtx = createContext<ChatContextValue | null>(null);

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

  const createConversation = useCallback((): string => {
    const id = uuid();
    const now = new Date().toISOString();
    const conversation: ChatConversation = {
      id,
      title: 'New conversation',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    dialogStatesRef.current[id] = {
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
    const userMessage: ChatMessage = { id: uuid(), role: 'user', content, timestamp: now };
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
              title: conversation.messages.length === 0 ? content.slice(0, 50) : conversation.title,
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
      tasks: crossDomain.tasks,
      financeAccounts: crossDomain.financeAccounts,
      transactions: crossDomain.transactions,
      knowledgeEntries: crossDomain.knowledgeEntries,
      knowledgeTopics: crossDomain.knowledgeTopics,
      lifestyleItems: crossDomain.lifestyleItems,
      workspaces: [],
      gamification: crossDomain.gamification,
      goalTags: crossDomain.settings.goalTags,
      currentSurface: 'chat',
    }, {
      lang: crossDomain.settings.assistantLanguage || 'en',
      conversationHistory: history,
      dialogState,
      endpoint: crossDomain.settings.ollamaEndpoint,
      model: crossDomain.settings.ollamaModel,
      handlers: {
        addTask: crossDomain.addTask,
        updateTask: crossDomain.updateTask,
        addCalendarEvent: crossDomain.addCalendarEvent,
        updateCalendarEvent: crossDomain.updateCalendarEvent,
        addTransaction: crossDomain.addTransaction,
        addKnowledgeEntry: crossDomain.addKnowledgeEntry,
        updateGamification: crossDomain.updateGamification,
      },
    });

    dialogStatesRef.current[conversationId] = result.dialogState;

    const assistantMessage: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      content: result.message,
      timestamp: new Date().toISOString(),
    };

    setConversations(prev =>
      prev.map(conversation =>
        conversation.id === conversationId
          ? { ...conversation, messages: [...conversation.messages, assistantMessage], updatedAt: new Date().toISOString() }
          : conversation
      )
    );
  }, [crossDomain]);

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
    deleteConversation,
    renameConversation,
  };

  return <ChatCtx.Provider value={value}>{children}</ChatCtx.Provider>;
}
