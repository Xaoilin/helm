import { useState, useRef, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { TIMING } from '../config/constants';
import { getCurrentUserId, isAuthenticated, isSupabaseReady } from '../store/supabase';
import type { AssistantRuntimeStatus } from '../services/assistantAvailability';
import { getAssistantProviderSetting, getAssistantRuntimeStatus } from '../services/assistantAvailability';
import { getHostedAssistantModelLabel, getHostedAssistantModelSetting } from '../services/assistantModels';
import { downloadConversationAsMarkdown, formatConversationAsMarkdown } from '../services/chatExport';
import {
  formatAssistantTokenCount,
  formatUsdEstimate,
  summarizeConversationAssistantBilling,
} from '../services/assistantBilling';

interface ExportFeedback {
  tone: 'success' | 'error';
  message: string;
}

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

function getEmptyStateMessage(status: AssistantRuntimeStatus, hostedModelLabel: string): string {
  if (status.state === 'ready' && status.activeProvider === 'hosted') {
    return `Lina is powered by hosted ${hostedModelLabel}. Ask anything about your schedule, tasks, or goals.`;
  }

  if (status.state === 'ready' && status.activeProvider === 'ollama') {
    return 'Lina is powered by your local Ollama setup. Ask anything about your schedule, tasks, or goals.';
  }

  return `${status.detail} Without a live AI planner, Lina will not guess or execute assistant actions from chat.`;
}

function formatConversationUpdatedAt(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  return date.toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ChatSurface() {
  const app = useApp();
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState<AssistantRuntimeStatus>(defaultAssistantStatus);
  const [exportFeedback, setExportFeedback] = useState<ExportFeedback | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const authSyncKey = `${isSupabaseReady()}:${isAuthenticated()}:${getCurrentUserId() || ''}`;
  const selectedProvider = getAssistantProviderSetting(app.settings);
  const hostedModelLabel = getHostedAssistantModelLabel(getHostedAssistantModelSetting(app.settings));

  const activeConv = app.conversations.find(c => c.id === app.activeConversationId);
  const canExportConversation = Boolean(activeConv && activeConv.messages.length > 0);
  const billingSummary = summarizeConversationAssistantBilling(activeConv);
  const billingTokenSummary = billingSummary
    ? `${formatAssistantTokenCount(billingSummary.totals.inputTokens)} input · ${formatAssistantTokenCount(billingSummary.totals.cachedTokens)} cached · ${formatAssistantTokenCount(billingSummary.totals.outputTokens)} output · ${formatAssistantTokenCount(billingSummary.totals.totalTokens)} total tokens`
    : null;

  useEffect(() => {
    let cancelled = false;
    getAssistantRuntimeStatus({
      assistantProvider: selectedProvider,
      hostedModel: app.settings.hostedModel,
      ollamaEndpoint: app.settings.ollamaEndpoint,
    }).then(status => {
      if (!cancelled) setAssistantStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedProvider, app.settings.hostedModel, app.settings.ollamaEndpoint, authSyncKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages.length, isTyping]);

  useEffect(() => {
    if (!exportFeedback) return;
    const timeout = window.setTimeout(() => setExportFeedback(null), TIMING.TOAST_LIFETIME);
    return () => window.clearTimeout(timeout);
  }, [exportFeedback]);

  useEffect(() => {
    setExportFeedback(null);
  }, [activeConv?.id]);

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

  const handleCopyConversation = async () => {
    if (!activeConv || activeConv.messages.length === 0) return;

    if (!navigator.clipboard?.writeText) {
      setExportFeedback({
        tone: 'error',
        message: 'Clipboard access is unavailable here. Export the Markdown file instead.',
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(formatConversationAsMarkdown(activeConv));
      setExportFeedback({
        tone: 'success',
        message: 'Conversation copied as Markdown.',
      });
    } catch {
      setExportFeedback({
        tone: 'error',
        message: 'Clipboard access failed. Export the Markdown file instead.',
      });
    }
  };

  const handleExportConversation = () => {
    if (!activeConv || activeConv.messages.length === 0) return;

    try {
      const { fileName } = downloadConversationAsMarkdown(activeConv);
      setExportFeedback({
        tone: 'success',
        message: `Exported ${fileName}.`,
      });
    } catch {
      setExportFeedback({
        tone: 'error',
        message: 'The Markdown export failed.',
      });
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
              <div
                className={`chat-list-item ${conv.id === app.activeConversationId ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => app.setActiveConversation(conv.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    app.setActiveConversation(conv.id);
                  }
                }}
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
              </div>
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
            <div className="chat-main-header">
              <div className="chat-main-copy">
                <h3 className="chat-main-title">{activeConv.title}</h3>
                <p className="chat-main-meta">
                  {activeConv.messages.length > 0
                    ? `${activeConv.messages.length} message${activeConv.messages.length === 1 ? '' : 's'} · Updated ${formatConversationUpdatedAt(activeConv.updatedAt)} · Copy or export this chat as Markdown for Codex.`
                    : 'Add a message to copy or export this chat as Markdown for Codex.'}
                </p>
                {billingSummary && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '12px 14px',
                      borderRadius: 12,
                      border: '1px solid #1e2030',
                      background: 'rgba(10, 12, 18, 0.58)',
                      display: 'grid',
                      gap: 4,
                      maxWidth: 760,
                    }}
                  >
                    <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: '#6b6f85' }}>
                      Estimated OpenAI conversation total
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#f5f7ff' }}>
                      {formatUsdEstimate(billingSummary.totalEstimatedUsd)}
                    </div>
                    <div style={{ fontSize: 12, color: '#cfd3e6' }}>
                      Estimated from OpenAI usage. {billingSummary.requestCount} hosted OpenAI request{billingSummary.requestCount === 1 ? '' : 's'} across {billingSummary.openAITurnCount} assistant turn{billingSummary.openAITurnCount === 1 ? '' : 's'}.
                    </div>
                    {billingTokenSummary && (
                      <div style={{ fontSize: 12, color: '#9ea4c5' }}>
                        {billingTokenSummary}
                      </div>
                    )}
                    {billingSummary.hasExcludedAssistantTurns && (
                      <div style={{ fontSize: 12, color: '#ffcc80' }}>
                        OpenAI-hosted turns only; other turns excluded.
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="chat-main-actions">
                {exportFeedback && (
                  <span className={`chat-export-status ${exportFeedback.tone}`} role="status">
                    {exportFeedback.message}
                  </span>
                )}
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => { void handleCopyConversation(); }}
                  disabled={!canExportConversation}
                >
                  Copy Markdown
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleExportConversation}
                  disabled={!canExportConversation}
                >
                  Export .md
                </button>
              </div>
            </div>
            <div className="chat-messages">
              {activeConv.messages.length === 0 && (
                <div className="empty-state" role="status">
                  <div className="empty-icon">&#128172;</div>
                  <h3>Start a conversation</h3>
                  <p>
                    {getEmptyStateMessage(assistantStatus, hostedModelLabel)}
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
              {getEmptyStateMessage(assistantStatus, hostedModelLabel)}
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
