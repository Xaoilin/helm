import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type {
  ChatConversation, ChatMessage,
  CalendarEvent, Task, GamificationProfile, Settings,
} from '../../types/domain';
import { loadStore, saveStore } from '../persistence';
import { chatWithOllama, buildSystemPrompt, testOllamaConnection, type OllamaMessage } from '../../services/ollamaApi';
import { OLLAMA_ENDPOINT } from '../../config';

// ── Mock assistant reply generator ──
function generateMockReply(userMessage: string): string {
  const lower = userMessage.toLowerCase();
  if (lower.includes('help') || lower.includes('what can you do')) {
    return "[Mocked] I'm HELM, your local assistant. I can help with engineering tasks, manage your calendar, and organize workspaces. Note: AI responses are currently mocked \u2014 connect a real LLM backend to get intelligent replies.";
  }
  if (lower.includes('calendar') || lower.includes('schedule') || lower.includes('meeting')) {
    return "[Mocked] I'd check your calendar for that. Head to the Calendar tab to manage your events and accounts. Real calendar integration requires connecting a Google or Outlook account in Integrations.";
  }
  if (lower.includes('deploy') || lower.includes('release') || lower.includes('ship')) {
    return "[Mocked] I can help with deployment planning. What would you like to deploy?";
  }
  if (lower.includes('credential') || lower.includes('password') || lower.includes('secret')) {
    return "[Mocked] Credential lookups prefer 1Password when connected. You can manage fallback credentials in the Credentials tab.";
  }
  return `[Mocked] I received your message: "${userMessage.slice(0, 80)}". AI responses are mocked in this version. Connect an LLM backend to enable real assistant capabilities.`;
}

/** Cross-domain data needed by sendMessage for the LLM system prompt and action parsing. */
export interface ChatCrossDomainData {
  calendarEvents: CalendarEvent[];
  tasks: Task[];
  gamification: GamificationProfile;
  settings: Settings;
  /** Callback to mutate tasks from the task context (for LLM action tags). */
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
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

  useEffect(() => {
    (async () => {
      const data = await loadStore<ChatConversation[]>('conversations');
      setConversations(data ?? []);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) saveStore('conversations', conversations); }, [conversations, loaded]);

  const createConversation = useCallback((): string => {
    const id = uuid();
    const now = new Date().toISOString();
    const conv: ChatConversation = { id, title: 'New conversation', messages: [], createdAt: now, updatedAt: now };
    setConversations(prev => [conv, ...prev]);
    setActiveConversationIdState(id);
    return id;
  }, []);

  const setActiveConversation = useCallback((id: string | null) => {
    setActiveConversationIdState(id);
  }, []);

  const sendMessage = useCallback(async (conversationId: string, content: string) => {
    const now = new Date().toISOString();
    const userMsg: ChatMessage = { id: uuid(), role: 'user', content, timestamp: now };

    // Add user message immediately
    setConversations(prev => {
      const exists = prev.some(c => c.id === conversationId);
      if (!exists) {
        const newConv: ChatConversation = { id: conversationId, title: content.slice(0, 50), messages: [userMsg], createdAt: now, updatedAt: now };
        return [newConv, ...prev];
      }
      return prev.map(c =>
        c.id === conversationId
          ? { ...c, messages: [...c.messages, userMsg], title: c.messages.length === 0 ? content.slice(0, 50) : c.title, updatedAt: now }
          : c
      );
    });
    setActiveConversationIdState(conversationId);

    // Try Ollama LLM, fall back to mock
    const { calendarEvents, tasks, gamification, settings, setTasks } = crossDomain;
    let replyContent: string;
    try {
      const endpoint = settings.ollamaEndpoint || OLLAMA_ENDPOINT;
      const model = settings.ollamaModel || undefined;
      const ollamaUp = await testOllamaConnection(endpoint);

      if (ollamaUp) {
        // Build messages from conversation history — use latest state via functional getter
        let convHistory: ChatMessage[] = [];
        setConversations(prev => {
          const conv = prev.find(c => c.id === conversationId);
          convHistory = conv?.messages || [];
          return prev; // no mutation
        });
        const history: OllamaMessage[] = convHistory.slice(-10).map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

        const lang = (settings.assistantLanguage || 'en') as 'en' | 'ar';
        const systemPrompt = buildSystemPrompt({ calendarEvents, tasks, gamification }, lang);

        const messages: OllamaMessage[] = [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content },
        ];

        replyContent = await chatWithOllama(messages, endpoint, model);

        // Parse and execute action tags
        const addTaskMatch = replyContent.match(/\[ADD_TASK:([^|]+)\|([^|]+)\|([^\]]+)\]/);
        if (addTaskMatch) {
          const priRaw = addTaskMatch[2].trim();
          const catRaw = addTaskMatch[3].trim();
          const newTask: Task = {
            id: uuid(),
            title: addTaskMatch[1].trim(),
            description: '',
            completed: false,
            priority: (['low', 'medium', 'high'].includes(priRaw) ? priRaw : 'medium') as Task['priority'],
            category: (['daily', 'task', 'goal'].includes(catRaw) ? catRaw : 'task') as Task['category'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setTasks(prev => [...prev, newTask]);
        }

        const completeTaskMatch = replyContent.match(/\[COMPLETE_TASK:([^\]]+)\]/);
        if (completeTaskMatch) {
          const title = completeTaskMatch[1].trim().toLowerCase();
          setTasks(prev => prev.map(t =>
            !t.completed && t.title.toLowerCase().includes(title)
              ? { ...t, completed: true, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
              : t
          ));
        }

        const completeHabitMatch = replyContent.match(/\[COMPLETE_HABIT:([^\]]+)\]/);
        if (completeHabitMatch) {
          const title = completeHabitMatch[1].trim().toLowerCase();
          setTasks(prev => prev.map(t =>
            t.category === 'daily' && !t.completed && t.title.toLowerCase().includes(title)
              ? { ...t, completed: true, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
              : t
          ));
        }

        // Strip all action tags from visible response
        replyContent = replyContent
          .replace(/\[NAV:\w+\]/g, '')
          .replace(/\[ADD_TASK:[^\]]+\]/g, '')
          .replace(/\[COMPLETE_TASK:[^\]]+\]/g, '')
          .replace(/\[COMPLETE_HABIT:[^\]]+\]/g, '')
          .trim();
      } else {
        replyContent = generateMockReply(content);
      }
    } catch {
      replyContent = generateMockReply(content);
    }

    const assistantMsg: ChatMessage = {
      id: uuid(), role: 'assistant',
      content: replyContent,
      timestamp: new Date().toISOString(),
    };

    setConversations(prev =>
      prev.map(c =>
        c.id === conversationId
          ? { ...c, messages: [...c.messages, assistantMsg], updatedAt: new Date().toISOString() }
          : c
      )
    );
  }, [crossDomain]);

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    setActiveConversationIdState(prev => prev === id ? null : prev);
  }, []);

  const renameConversation = useCallback((id: string, title: string) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
  }, []);

  const value: ChatContextValue = {
    conversations, activeConversationId, loaded,
    createConversation, setActiveConversation, sendMessage, deleteConversation, renameConversation,
  };

  return <ChatCtx.Provider value={value}>{children}</ChatCtx.Provider>;
}
