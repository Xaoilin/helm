import { useState, useRef, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { getCurrentUserId, isAuthenticated, isSupabaseReady } from '../store/supabase';
import type { AssistantRuntimeStatus } from '../services/assistantAvailability';
import { getAssistantProviderSetting, getAssistantRuntimeStatus } from '../services/assistantAvailability';

function defaultAssistantStatus(): AssistantRuntimeStatus {
  return {
    activeProvider: null,
    state: 'checking',
    headline: 'Checking assistant runtime...',
    detail: 'Lina is checking which AI provider is currently available.',
  };
}

function getStatusBadge(status: AssistantRuntimeStatus): string {
  switch (status.state) {
    case 'ready':
      return `🟢 ${status.headline}`;
    case 'sign_in_required':
    case 'not_configured':
      return `🟡 ${status.headline}`;
    case 'offline':
      return `🔴 ${status.headline}`;
    case 'checking':
    default:
      return 'Checking assistant...';
  }
}

function getEmptyStateMessage(status: AssistantRuntimeStatus): string {
  if (status.state === 'ready' && status.activeProvider === 'hosted') {
    return 'Lina is powered by hosted GPT-5.4-mini. Ask anything about your schedule, tasks, or goals.';
  }

  if (status.state === 'ready' && status.activeProvider === 'ollama') {
    return 'Lina is powered by your local Ollama setup. Ask anything about your schedule, tasks, or goals.';
  }

  return `${status.detail} Without a live AI provider, Lina still handles built-in commands like navigation, task updates, event scheduling, finance logging, and knowledge notes.`;
}

export default function ChatSurface() {
  const app = useApp();
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState<AssistantRuntimeStatus>(defaultAssistantStatus);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const authSyncKey = `${isSupabaseReady()}:${isAuthenticated()}:${getCurrentUserId() || ''}`;
  const selectedProvider = getAssistantProviderSetting(app.settings);

  const activeConv = app.conversations.find(c => c.id === app.activeConversationId);

  useEffect(() => {
    let cancelled = false;
    getAssistantRuntimeStatus({
      assistantProvider: selectedProvider,
      ollamaEndpoint: app.settings.ollamaEndpoint,
    }).then(status => {
      if (!cancelled) setAssistantStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedProvider, app.settings.ollamaEndpoint, authSyncKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages.length, isTyping]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isTyping) return;
    let convId = app.activeConversationId;
    if (!convId) {
      convId = app.createConversation();
    }
    setInput('');
    setIsTyping(true);
    await app.sendMessage(convId, text);
    setIsTyping(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickPrompts = [
    'What should I focus on today?',
    'What meetings do I have coming up?',
    'How am I doing with my habits?',
    'Help me plan my week',
  ];

  return (
    <div className="chat-layout">
      {/* Conversation sidebar */}
      <div className="chat-sidebar">
        <div className="chat-sidebar-header">
          <h3>Conversations</h3>
          <button className="btn-icon" onClick={() => { app.createConversation(); }} title="New conversation" aria-label="New conversation">+</button>
        </div>
        <div className="chat-list">
          {app.conversations.length === 0 && (
            <div style={{ padding: '20px 16px', color: '#4a4e62', fontSize: '12px' }} role="status">
              No conversations yet
            </div>
          )}
          {app.conversations.map(conv => (
            <div key={conv.id}>
              <button
                className={`chat-list-item ${conv.id === app.activeConversationId ? 'active' : ''}`}
                onClick={() => app.setActiveConversation(conv.id)}
              >
                <span className="title">
                  {editingId === conv.id ? (
                    <input
                      className="form-input"
                      style={{ padding: '2px 6px', fontSize: '12px' }}
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onBlur={() => {
                        if (editTitle.trim()) app.renameConversation(conv.id, editTitle.trim());
                        setEditingId(null);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          if (editTitle.trim()) app.renameConversation(conv.id, editTitle.trim());
                          setEditingId(null);
                        }
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onClick={e => e.stopPropagation()}
                      autoFocus
                    />
                  ) : conv.title}
                </span>
                {editingId !== conv.id && (
                  <span className="actions-row" style={{ marginLeft: 4, flexShrink: 0 }}>
                    <button
                      className="btn-icon btn-sm"
                      style={{ border: 'none', padding: '2px 4px', fontSize: '11px' }}
                      onClick={e => { e.stopPropagation(); setEditingId(conv.id); setEditTitle(conv.title); }}
                      title="Rename"
                      aria-label="Rename conversation"
                    >
                      &#9998;
                    </button>
                    <button
                      className="btn-icon btn-sm"
                      style={{ border: 'none', padding: '2px 4px', fontSize: '11px', color: '#ff6b6b' }}
                      onClick={e => { e.stopPropagation(); setDeletingId(conv.id); }}
                      title="Delete"
                      aria-label="Delete conversation"
                    >
                      &times;
                    </button>
                  </span>
                )}
              </button>
              {deletingId === conv.id && (
                <div className="confirm-bar" style={{ margin: '4px 8px' }} role="alert">
                  Delete this conversation?
                  <button className="btn btn-danger btn-sm" onClick={() => { app.deleteConversation(conv.id); setDeletingId(null); }}>Delete</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setDeletingId(null)}>Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid #1e2030' }}>
          <span className="mocked-indicator" role="status">
            {getStatusBadge(assistantStatus)}
          </span>
        </div>
      </div>

      {/* Chat main area */}
      <div className="chat-main">
        {activeConv ? (
          <>
            <div className="chat-messages">
              {activeConv.messages.length === 0 && (
                <div className="empty-state" role="status">
                  <div className="empty-icon">&#128172;</div>
                  <h3>Start a conversation</h3>
                  <p>
                    {getEmptyStateMessage(assistantStatus)}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {quickPrompts.map(p => (
                      <button
                        key={p}
                        className="btn btn-secondary btn-sm"
                        onClick={() => { handleSendQuick(p); }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {activeConv.messages.map(msg => (
                <div key={msg.id} className={`chat-message ${msg.role}`}>
                  {msg.content}
                </div>
              ))}
              {isTyping && (
                <div className="chat-message assistant" style={{ opacity: 0.6 }}>
                  <span className="va-dots" style={{ display: 'inline-flex', gap: 3 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c4a0f7', animation: 'vaDotBounce 1.2s ease-in-out infinite' }} />
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c4a0f7', animation: 'vaDotBounce 1.2s ease-in-out infinite', animationDelay: '0.2s' }} />
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c4a0f7', animation: 'vaDotBounce 1.2s ease-in-out infinite', animationDelay: '0.4s' }} />
                  </span>
                  {' '}Lina is thinking...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="chat-input-bar">
              <input
                className="form-input"
                placeholder={isTyping ? 'Lina is thinking...' : 'Type a message...'}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isTyping}
              />
              <button className="btn btn-primary" onClick={handleSend} disabled={isTyping || !input.trim()}>Send</button>
            </div>
          </>
        ) : (
          <div className="empty-state" style={{ flex: 1 }} role="status">
            <div className="empty-icon">&#128172;</div>
            <h3>Lina Assistant</h3>
            <p>
              {getEmptyStateMessage(assistantStatus)}
            </p>
            <button className="btn btn-primary" onClick={() => app.createConversation()}>New conversation</button>
            {app.conversations.length === 0 && (
              <div style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {quickPrompts.map(p => (
                  <button
                    key={p}
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      const id = app.createConversation();
                      app.sendMessage(id, p);
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // Helper for quick prompts inside active conversation
  async function handleSendQuick(text: string) {
    if (isTyping) return;
    const convId = activeConv?.id || app.createConversation();
    setIsTyping(true);
    await app.sendMessage(convId, text);
    setIsTyping(false);
  }
}
