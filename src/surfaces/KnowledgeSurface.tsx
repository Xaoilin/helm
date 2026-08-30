import { useState, useMemo, useCallback } from 'react';
import { useKnowledgeContext } from "../store/contexts/KnowledgeContext";
import ElifBManualEvidence from '../components/knowledge/ElifBManualEvidence';
import type { KnowledgeTopic, KnowledgeEntry, KnowledgeSource, LifestyleItem, LifestyleType, LifestyleStatus } from '../types/domain';

type Tab = 'browse' | 'add' | 'search' | 'lifestyle';

const HARAM_STATUSES: { value: LifestyleStatus; label: string; color: string; emoji: string }[] = [
  { value: 'struggling', label: 'Struggling', color: '#ff6b6b', emoji: '\u{1F534}' },
  { value: 'working-on-it', label: 'Working on it', color: '#f59e0b', emoji: '\u{1F7E1}' },
  { value: 'avoiding', label: 'Avoiding', color: '#3b82f6', emoji: '\u{1F535}' },
  { value: 'mastered', label: 'Mastered', color: '#22c55e', emoji: '\u{1F7E2}' },
];

const HALAL_STATUSES: { value: LifestyleStatus; label: string; color: string; emoji: string }[] = [
  { value: 'want-to-start', label: 'Want to start', color: '#6b6f85', emoji: '\u{26AA}' },
  { value: 'sometimes', label: 'Sometimes', color: '#f59e0b', emoji: '\u{1F7E1}' },
  { value: 'practicing', label: 'Practicing', color: '#3b82f6', emoji: '\u{1F535}' },
  { value: 'consistent', label: 'Consistent', color: '#22c55e', emoji: '\u{1F7E2}' },
];

const AVOID_STATUSES = HARAM_STATUSES; // major/minor sins use same statuses as haram

const PRACTICE_TYPES: LifestyleType[] = ['halal', 'wajib-both', 'wajib-women', 'wajib-men'];

function getStatusInfo(type: LifestyleType, status: LifestyleStatus) {
  const list = PRACTICE_TYPES.includes(type) ? HALAL_STATUSES : AVOID_STATUSES;
  return list.find(s => s.value === status) || list[0];
}

interface ColumnConfig {
  type: LifestyleType;
  title: string;
  emoji: string;
  color: string;
}

const LIFESTYLE_COLUMNS: ColumnConfig[] = [
  { type: 'haram', title: 'Most Haram', emoji: '\u{1F6D1}', color: '#ff6b6b' },
  { type: 'major-sin', title: 'Major Sins', emoji: '\u{26A0}\uFE0F', color: '#f59e0b' },
  { type: 'wajib-both', title: 'Wajib (Both)', emoji: '\u{1F54C}', color: '#14b8a6' },
  { type: 'wajib-women', title: 'Wajib (Women)', emoji: '\u{1F9D5}', color: '#ec4899' },
  { type: 'wajib-men', title: 'Wajib (Men)', emoji: '\u{1F9D4}', color: '#3b82f6' },
  { type: 'halal', title: 'Halal Practices', emoji: '\u2705', color: '#22c55e' },
];
type SourceFilter = 'all' | 'quran' | 'hadith' | 'scholarly' | 'other';

const HADITH_COLLECTIONS = ['Bukhari', 'Muslim', 'Tirmidhi', 'Abu Dawud', 'An-Nasai', 'Ibn Majah', 'Muwatta', 'Ahmad', 'Other'];
const TOPIC_ICONS = ['\u{1F4D6}', '\u{1F54C}', '\u{1F4DC}', '\u2696\uFE0F', '\u{1F525}', '\u2B50', '\u{1F319}', '\u{1F64F}', '\u{1F3DB}', '\u{1F4DA}', '\u{1F30D}', '\u2764\uFE0F', '\u{1F9ED}', '\u{1F6E1}', '\u{1F3AF}', '\u{2728}'];
const TOPIC_COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#f97316', '#ef4444'];

/** Render a source string as a clickable link where possible. */
function renderSourceLink(source: string) {
  // Direct URL
  if (/^https?:\/\//i.test(source)) {
    return <a href={source} target="_blank" rel="noopener noreferrer" style={{ color: '#4f5bff' }}>{source}</a>;
  }
  // Quran reference: "Quran 2:255" or "2:255"
  const quranMatch = source.match(/(?:quran\s*)?(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?/i);
  if (quranMatch) {
    const [, surah, ayah] = quranMatch;
    const url = `https://quran.com/${surah}/${ayah}`;
    return <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#3ab553' }}>{source}</a>;
  }
  // Hadith reference: "Bukhari 1234", "Muslim 5678"
  const hadithMatch = source.match(/(bukhari|muslim|tirmidhi|abu dawud|nasai|ibn majah|muwatta|ahmad)\s*(\d+)/i);
  if (hadithMatch) {
    const [, collection, number] = hadithMatch;
    const url = `https://sunnah.com/search?q=${encodeURIComponent(collection + ' ' + number)}`;
    return <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#f59e0b' }}>{source}</a>;
  }
  // Plain text
  return <>{source}</>;
}

function formatSource(src: KnowledgeSource): string {
  if (src.type === 'quran') {
    const ayah = src.ayahEnd && src.ayahEnd !== src.ayahStart ? `${src.ayahStart}-${src.ayahEnd}` : `${src.ayahStart}`;
    return `Quran ${src.surah}:${ayah}`;
  }
  if (src.type === 'hadith') return `${src.collection} ${src.hadithNumber}`;
  if (src.type === 'scholarly') return `${src.author || ''}${src.author && src.title ? ' - ' : ''}${src.title || ''}`;
  return src.title || 'Other';
}

function sourceTagClass(type: KnowledgeSource['type']): string {
  switch (type) {
    case 'quran': return 'kb-src-quran';
    case 'hadith': return 'kb-src-hadith';
    case 'scholarly': return 'kb-src-scholarly';
    default: return 'kb-src-other';
  }
}

export default function KnowledgeSurface() {
  const knowledge = useKnowledgeContext();
  const [tab, setTab] = useState<Tab>('browse');
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);

  // Topic modal
  const [showTopicModal, setShowTopicModal] = useState(false);
  const [editingTopic, setEditingTopic] = useState<KnowledgeTopic | null>(null);
  const [topicName, setTopicName] = useState('');
  const [topicDesc, setTopicDesc] = useState('');
  const [topicIcon, setTopicIcon] = useState('\u{1F4D6}');
  const [topicColor, setTopicColor] = useState('#3b82f6');

  // Add Entry form
  const [lastTopicId, setLastTopicId] = useState<string>('');
  const [entryTopicId, setEntryTopicId] = useState('');
  const [entryTitle, setEntryTitle] = useState('');
  const [entryContent, setEntryContent] = useState('');
  const [entrySources, setEntrySources] = useState<KnowledgeSource[]>([]);
  const [entryTags, setEntryTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [editingEntry, setEditingEntry] = useState<KnowledgeEntry | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSourceFilter, setSearchSourceFilter] = useState<SourceFilter>('all');
  const [searchTopicFilter, setSearchTopicFilter] = useState('all');

  // Lifestyle tracker
  const [showLifestyleForm, setShowLifestyleForm] = useState(false);
  const [editingLifestyle, setEditingLifestyle] = useState<LifestyleItem | null>(null);
  const [lsType, setLsType] = useState<LifestyleType>('haram');
  const [lsTitle, setLsTitle] = useState('');
  const [lsNotes, setLsNotes] = useState('');
  const [lsStatus, setLsStatus] = useState<LifestyleStatus>('struggling');
  const [lsSources, setLsSources] = useState<string[]>([]);
  const [lsNewSource, setLsNewSource] = useState('');
  const [deletingLifestyleId, setDeletingLifestyleId] = useState<string | null>(null);
  const [weekAgoIso] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString();
  });

  // ── Derived data ──
  const totalEntries = knowledge.knowledgeEntries.length;
  const thisWeekEntries = useMemo(() => {
    return knowledge.knowledgeEntries.filter(e => e.createdAt >= weekAgoIso).length;
  }, [knowledge.knowledgeEntries, weekAgoIso]);

  const selectedTopic = knowledge.knowledgeTopics.find(t => t.id === selectedTopicId);

  const sortedKnowledgeTopics = useMemo(
    () => [...knowledge.knowledgeTopics].sort((a, b) => a.sortOrder - b.sortOrder),
    [knowledge.knowledgeTopics]
  );

  const topicEntries = useMemo(() => {
    if (!selectedTopicId) return [];
    let entries = knowledge.knowledgeEntries.filter(e => e.topicId === selectedTopicId);
    if (sourceFilter !== 'all') entries = entries.filter(e => e.sources.some(s => s.type === sourceFilter));
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [knowledge.knowledgeEntries, selectedTopicId, sourceFilter]);

  const recentEntries = useMemo(() =>
    [...knowledge.knowledgeEntries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    [knowledge.knowledgeEntries]
  );

  const searchResults = useMemo(() => {
    if (!searchQuery.trim() && searchSourceFilter === 'all' && searchTopicFilter === 'all') return [];
    const q = searchQuery.toLowerCase();
    return knowledge.knowledgeEntries.filter(e => {
      if (searchTopicFilter !== 'all' && e.topicId !== searchTopicFilter) return false;
      if (searchSourceFilter !== 'all' && !e.sources.some(s => s.type === searchSourceFilter)) return false;
      if (q) {
        const sourceText = e.sources.map(formatSource).join(' ').toLowerCase();
        return e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q) || sourceText.includes(q) || e.tags.some(t => t.toLowerCase().includes(q));
      }
      return true;
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [knowledge.knowledgeEntries, searchQuery, searchSourceFilter, searchTopicFilter]);

  const getEntryCountForTopic = (topicId: string) => knowledge.knowledgeEntries.filter(e => e.topicId === topicId).length;

  const getSourceComposition = (topicId: string) => {
    const entries = knowledge.knowledgeEntries.filter(e => e.topicId === topicId);
    if (entries.length === 0) return { quran: 0, hadith: 0, other: 0 };
    const total = entries.length;
    const quran = entries.filter(e => e.sources.some(s => s.type === 'quran')).length;
    const hadith = entries.filter(e => e.sources.some(s => s.type === 'hadith')).length;
    const other = total - Math.max(quran, hadith);
    return { quran: quran / total, hadith: hadith / total, other: Math.max(0, other / total) };
  };

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    knowledge.knowledgeEntries.forEach(e => e.tags.forEach(t => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [knowledge.knowledgeEntries]);

  // Lifestyle derived
  const itemsByType = useMemo(() => {
    const map: Record<LifestyleType, LifestyleItem[]> = { haram: [], 'major-sin': [], 'wajib-both': [], 'wajib-women': [], 'wajib-men': [], halal: [] };
    for (const item of knowledge.lifestyleItems) {
      (map[item.type] || map.haram).push(item);
    }
    for (const key of Object.keys(map) as LifestyleType[]) {
      map[key].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }
    return map;
  }, [knowledge.lifestyleItems]);
  const [dragId, setDragId] = useState<string | null>(null);

  const openAddLifestyle = (type: LifestyleType) => {
    setLsType(type); setLsTitle(''); setLsNotes(''); setLsSources([]); setLsNewSource('');
    setLsStatus(PRACTICE_TYPES.includes(type) ? 'want-to-start' : 'struggling');
    setEditingLifestyle(null); setShowLifestyleForm(true);
  };
  const openEditLifestyle = (item: LifestyleItem) => {
    setLsType(item.type); setLsTitle(item.title); setLsNotes(item.notes); setLsSources(item.sources || []);
    setLsStatus(item.status); setEditingLifestyle(item); setShowLifestyleForm(true);
  };
  const saveLifestyle = () => {
    if (!lsTitle.trim()) return;
    const allSources = lsNewSource.trim() ? [...lsSources, lsNewSource.trim()] : lsSources;
    if (editingLifestyle) {
      knowledge.updateLifestyleItem(editingLifestyle.id, { type: lsType, title: lsTitle.trim(), notes: lsNotes.trim(), status: lsStatus, sources: allSources.length > 0 ? allSources : undefined });
    }
    else {
      const existing = knowledge.lifestyleItems.filter(i => i.type === lsType);
      knowledge.addLifestyleItem({ type: lsType, title: lsTitle.trim(), notes: lsNotes.trim(), status: lsStatus, sources: allSources.length > 0 ? allSources : undefined, sortOrder: existing.length });
    }
    setShowLifestyleForm(false);
  };

  const handleDragStart = (id: string) => { setDragId(id); };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  // Drop onto a specific item (reorder within column or move between columns)
  const handleDrop = (targetId: string, targetType: LifestyleType) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const draggedItem = knowledge.lifestyleItems.find(i => i.id === dragId);
    if (!draggedItem) { setDragId(null); return; }

    const movingBetweenColumns = draggedItem.type !== targetType;

    if (movingBetweenColumns) {
      // Change type + reset status if moving between halal and avoid columns
      const targetIsPractice = PRACTICE_TYPES.includes(targetType);
      const sourceIsPractice = PRACTICE_TYPES.includes(draggedItem.type);
      const newStatus = targetIsPractice === sourceIsPractice
        ? draggedItem.status  // same category family, keep status
        : targetIsPractice
          ? 'want-to-start' as LifestyleStatus
          : 'struggling' as LifestyleStatus;
      const targetItems = itemsByType[targetType];
      const toIdx = targetItems.findIndex(i => i.id === targetId);
      knowledge.updateLifestyleItem(dragId, { type: targetType, status: newStatus, sortOrder: toIdx >= 0 ? toIdx : targetItems.length });
      // Re-sort the target column
      const newIds = targetItems.map(i => i.id);
      newIds.splice(toIdx >= 0 ? toIdx : newIds.length, 0, dragId);
      knowledge.reorderLifestyleItems(newIds);
    } else {
      // Same column reorder
      const items = itemsByType[targetType];
      const ids = items.map(i => i.id);
      const fromIdx = ids.indexOf(dragId);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) { setDragId(null); return; }
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, dragId);
      knowledge.reorderLifestyleItems(ids);
    }
    setDragId(null);
  };

  // Drop onto column itself (empty area) — moves item to end of that column
  const handleColumnDrop = (targetType: LifestyleType, e: React.DragEvent) => {
    e.preventDefault();
    if (!dragId) return;
    const draggedItem = knowledge.lifestyleItems.find(i => i.id === dragId);
    if (!draggedItem) { setDragId(null); return; }

    if (draggedItem.type !== targetType) {
      const targetIsPractice = PRACTICE_TYPES.includes(targetType);
      const sourceIsPractice = PRACTICE_TYPES.includes(draggedItem.type);
      const newStatus = targetIsPractice === sourceIsPractice
        ? draggedItem.status  // same category family, keep status
        : targetIsPractice
          ? 'want-to-start' as LifestyleStatus
          : 'struggling' as LifestyleStatus;
      knowledge.updateLifestyleItem(dragId, { type: targetType, status: newStatus, sortOrder: itemsByType[targetType].length });
    }
    setDragId(null);
  };

  const cycleStatus = (item: LifestyleItem) => {
    const statuses = item.type === 'haram' ? HARAM_STATUSES : HALAL_STATUSES;
    const idx = statuses.findIndex(s => s.value === item.status);
    const next = statuses[(idx + 1) % statuses.length];
    knowledge.updateLifestyleItem(item.id, { status: next.value });
  };

  // ── Topic actions ──
  const openAddTopic = () => {
    setTopicName(''); setTopicDesc(''); setTopicIcon('\u{1F4D6}'); setTopicColor('#3b82f6');
    setEditingTopic(null); setShowTopicModal(true);
  };
  const openEditTopic = (t: KnowledgeTopic) => {
    setTopicName(t.name); setTopicDesc(t.description); setTopicIcon(t.icon); setTopicColor(t.color);
    setEditingTopic(t); setShowTopicModal(true);
  };
  const saveTopic = () => {
    if (!topicName.trim()) return;
    const data = { name: topicName.trim(), description: topicDesc.trim(), icon: topicIcon, color: topicColor, sortOrder: knowledge.knowledgeTopics.length };
    if (editingTopic) knowledge.updateKnowledgeTopic(editingTopic.id, data);
    else knowledge.addKnowledgeTopic(data);
    setShowTopicModal(false);
  };

  // ── Entry actions ──
  const resetEntryForm = useCallback(() => {
    setEntryTitle(''); setEntryContent(''); setEntrySources([]); setEntryTags([]); setTagInput(''); setEditingEntry(null);
  }, []);

  const openAddEntry = (presetTopicId?: string) => {
    resetEntryForm();
    setEntryTopicId(presetTopicId || lastTopicId || knowledge.knowledgeTopics[0]?.id || '');
    setTab('add');
  };
  const openEditEntry = (entry: KnowledgeEntry) => {
    setEntryTopicId(entry.topicId); setEntryTitle(entry.title); setEntryContent(entry.content);
    setEntrySources([...entry.sources]); setEntryTags([...entry.tags]); setEditingEntry(entry);
    setTab('add');
  };
  const moveEntryToTopic = (entry: KnowledgeEntry, targetTopicId: string) => {
    if (!targetTopicId || targetTopicId === entry.topicId) return;
    if (!knowledge.knowledgeTopics.some(topic => topic.id === targetTopicId)) return;
    knowledge.updateKnowledgeEntry(entry.id, { topicId: targetTopicId });
    setLastTopicId(targetTopicId);
    setSelectedTopicId(targetTopicId);
    setExpandedEntryId(entry.id);
  };
  const saveEntry = (addAnother: boolean) => {
    if (!entryTitle.trim() || !entryTopicId) return;
    const data = { topicId: entryTopicId, title: entryTitle.trim(), content: entryContent.trim(), sources: entrySources, tags: entryTags };
    if (editingEntry) {
      knowledge.updateKnowledgeEntry(editingEntry.id, data);
      setTab('browse'); setSelectedTopicId(entryTopicId);
    } else {
      knowledge.addKnowledgeEntry(data);
      setLastTopicId(entryTopicId);
      if (addAnother) { resetEntryForm(); setEntryTopicId(entryTopicId); }
      else { setTab('browse'); setSelectedTopicId(entryTopicId); }
    }
  };

  // ── Source management ──
  const addSource = (type: KnowledgeSource['type']) => {
    setEntrySources(prev => [...prev, { type }]);
  };
  const updateSource = (idx: number, updates: Partial<KnowledgeSource>) => {
    setEntrySources(prev => prev.map((s, i) => i === idx ? { ...s, ...updates } : s));
  };
  const removeSource = (idx: number) => {
    setEntrySources(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Tag management ──
  const addTag = () => {
    const t = tagInput.trim();
    if (t && !entryTags.includes(t)) { setEntryTags(prev => [...prev, t]); }
    setTagInput('');
  };

  // ── Render source badge ──
  const renderSourceBadge = (src: KnowledgeSource, key: number) => (
    <span key={key} className={`kb-src-badge ${sourceTagClass(src.type)}`}>{formatSource(src)}</span>
  );

  // ── Render entry card ──
  const renderEntryCard = (entry: KnowledgeEntry, showTopic = false) => {
    const expanded = expandedEntryId === entry.id;
    return (
      <div key={entry.id} className={`kb-entry-card ${expanded ? 'expanded' : ''}`}>
        <div className="kb-entry-header" onClick={() => setExpandedEntryId(expanded ? null : entry.id)}>
          <div className="kb-entry-title">{entry.title}</div>
          <div className="kb-entry-sources">{entry.sources.map((s, i) => renderSourceBadge(s, i))}</div>
        </div>
        {!expanded && (
          <div className="kb-entry-preview">{entry.content.slice(0, 120)}{entry.content.length > 120 ? '...' : ''}</div>
        )}
        {showTopic && (
          <div className="kb-entry-topic-crumb">
            in: {knowledge.knowledgeTopics.find(t => t.id === entry.topicId)?.name || 'Unknown'}
          </div>
        )}
        {expanded && (
          <div className="kb-entry-body">
            <div className="kb-entry-content">{entry.content}</div>
            {entry.tags.length > 0 && (
              <div className="kb-entry-tags">{entry.tags.map(t => <span key={t} className="tag tag-daily">{t}</span>)}</div>
            )}
            <div className="kb-entry-meta">
              Added {new Date(entry.createdAt).toLocaleDateString()} &middot; Updated {new Date(entry.updatedAt).toLocaleDateString()}
            </div>
            <div className="kb-entry-controls">
              {sortedKnowledgeTopics.length > 1 && (
                <label className="kb-entry-move">
                  <span>Move to</span>
                  <select
                    className="form-select"
                    value={entry.topicId}
                    aria-label={`Move ${entry.title} to topic`}
                    onClick={e => e.stopPropagation()}
                    onChange={e => {
                      e.stopPropagation();
                      moveEntryToTopic(entry, e.target.value);
                    }}
                  >
                    {sortedKnowledgeTopics.map(topic => (
                      <option key={topic.id} value={topic.id}>{topic.icon} {topic.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <div className="actions-row">
                <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); openEditEntry(entry); }}>Edit</button>
                {deletingEntryId === entry.id ? (
                  <div className="confirm-bar" role="alert" style={{ margin: 0 }}>
                    Delete entry?
                    <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); knowledge.removeKnowledgeEntry(entry.id); setDeletingEntryId(null); setExpandedEntryId(null); }}>Delete</button>
                    <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); setDeletingEntryId(null); }}>Cancel</button>
                  </div>
                ) : (
                  <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); setDeletingEntryId(entry.id); }}>Delete</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Knowledge</h1>
          <div className="subtitle">
            {knowledge.knowledgeTopics.length === 0 ? 'Start building your knowledge base'
              : `${knowledge.knowledgeTopics.length} topic${knowledge.knowledgeTopics.length !== 1 ? 's' : ''} \u00b7 ${totalEntries} entr${totalEntries !== 1 ? 'ies' : 'y'}${thisWeekEntries > 0 ? ` \u00b7 ${thisWeekEntries} added this week` : ''}`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => openAddEntry()}>+ Add Entry</button>
      </div>
      <div className="surface-body">
        <ElifBManualEvidence />
        <div className="tabs">
          <button className={`tab ${tab === 'browse' ? 'active' : ''}`} onClick={() => { setTab('browse'); setSelectedTopicId(null); }}>Browse</button>
          <button className={`tab ${tab === 'add' ? 'active' : ''}`} onClick={() => { setTab('add'); if (!editingEntry) resetEntryForm(); }}>
            {editingEntry ? 'Edit Entry' : 'Add Entry'}
          </button>
          <button className={`tab ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>Search</button>
          <button className={`tab ${tab === 'lifestyle' ? 'active' : ''}`} onClick={() => setTab('lifestyle')}>
            Lifestyle{knowledge.lifestyleItems.length > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: '#6b6f85' }}>{knowledge.lifestyleItems.length}</span>}
          </button>
        </div>

        {/* ══ Browse Tab ══ */}
        {tab === 'browse' && !selectedTopicId && (
          <>
            {knowledge.knowledgeTopics.length === 0 ? (
              <div className="empty-state" role="status">
                <div className="empty-icon" style={{ fontSize: 36 }}>{'\u{1F4DA}'}</div>
                <h3>Start Your Knowledge Base</h3>
                <p>Organize your Islamic learning into topics. Each topic holds entries with Quran and Hadith references.</p>
                <button className="btn btn-primary" onClick={openAddTopic}>+ Create First Topic</button>
              </div>
            ) : (
              <>
                <div className="kb-topic-grid">
                  {sortedKnowledgeTopics.map(topic => {
                    const count = getEntryCountForTopic(topic.id);
                    const comp = getSourceComposition(topic.id);
                    return (
                      <div key={topic.id} className="kb-topic-card" onClick={() => setSelectedTopicId(topic.id)} style={{ borderLeftColor: topic.color }}>
                        <div className="kb-topic-icon">{topic.icon}</div>
                        <div className="kb-topic-info">
                          <div className="kb-topic-name">{topic.name}</div>
                          <div className="kb-topic-count">{count} entr{count !== 1 ? 'ies' : 'y'}</div>
                        </div>
                        <button className="btn-icon btn-sm" onClick={e => { e.stopPropagation(); openEditTopic(topic); }} aria-label={`Edit ${topic.name}`} style={{ fontSize: 11, opacity: 0.5 }}>Edit</button>
                        {count > 0 && (
                          <div className="kb-composition-bar">
                            <div className="kb-comp-quran" style={{ width: `${comp.quran * 100}%` }} />
                            <div className="kb-comp-hadith" style={{ width: `${comp.hadith * 100}%` }} />
                            <div className="kb-comp-other" style={{ width: `${comp.other * 100}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="kb-topic-card kb-add-topic" onClick={openAddTopic}>
                    <div className="kb-topic-icon" style={{ opacity: 0.4 }}>+</div>
                    <div className="kb-topic-info"><div className="kb-topic-name" style={{ color: '#6b6f85' }}>Add Topic</div></div>
                  </div>
                </div>

                {recentEntries.length > 0 && (
                  <>
                    <div className="section-heading" style={{ marginTop: 24 }}>Recently Added</div>
                    {recentEntries.map(e => renderEntryCard(e, true))}
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ══ Browse: Topic Detail ══ */}
        {tab === 'browse' && selectedTopicId && selectedTopic && (
          <>
            <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedTopicId(null); setExpandedEntryId(null); }} style={{ marginBottom: 12 }}>&larr; Back to Topics</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <span style={{ fontSize: 32 }}>{selectedTopic.icon}</span>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>{selectedTopic.name}</h2>
                {selectedTopic.description && <div style={{ fontSize: 12, color: '#9499b0', marginTop: 2 }}>{selectedTopic.description}</div>}
                <div style={{ fontSize: 11, color: '#6b6f85', marginTop: 2 }}>{topicEntries.length} entr{topicEntries.length !== 1 ? 'ies' : 'y'}</div>
              </div>
              <div style={{ marginLeft: 'auto' }} className="actions-row">
                <button className="btn btn-primary btn-sm" onClick={() => openAddEntry(selectedTopicId)}>+ Add Entry</button>
                {deletingTopicId === selectedTopicId ? (
                  <div className="confirm-bar" role="alert" style={{ margin: 0 }}>
                    Delete topic and all {topicEntries.length} entries?
                    <button className="btn btn-danger btn-sm" onClick={() => { knowledge.removeKnowledgeTopic(selectedTopicId); setSelectedTopicId(null); setDeletingTopicId(null); }}>Delete</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setDeletingTopicId(null)}>Cancel</button>
                  </div>
                ) : (
                  <button className="btn btn-danger btn-sm" onClick={() => setDeletingTopicId(selectedTopicId)}>Delete Topic</button>
                )}
              </div>
            </div>

            <div className="filter-bar">
              {(['all', 'quran', 'hadith', 'scholarly', 'other'] as SourceFilter[]).map(f => (
                <button key={f} className={`btn btn-sm ${sourceFilter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSourceFilter(f)}>
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            {topicEntries.length === 0 ? (
              <div className="empty-state" role="status">
                <div className="empty-icon" style={{ fontSize: 36 }}>{'\u{270D}\uFE0F'}</div>
                <h3>No entries yet</h3>
                <p>Add your first note with Quran or Hadith references.</p>
                <button className="btn btn-primary" onClick={() => openAddEntry(selectedTopicId)}>+ Add Entry</button>
              </div>
            ) : topicEntries.map(e => renderEntryCard(e))}
          </>
        )}

        {/* ══ Add Entry Tab ══ */}
        {tab === 'add' && (
          <div style={{ maxWidth: 700 }}>
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>{editingEntry ? 'Edit Entry' : 'Add Entry'}</h2>
            <div className="form-group">
              <label htmlFor="kb-topic">Topic</label>
              <select id="kb-topic" className="form-select" value={entryTopicId} onChange={e => setEntryTopicId(e.target.value)}>
                <option value="">Select a topic...</option>
                {sortedKnowledgeTopics.map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
              </select>
              {knowledge.knowledgeTopics.length === 0 && (
                <button className="btn btn-secondary btn-sm" style={{ marginTop: 6 }} onClick={openAddTopic}>+ Create Topic First</button>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="kb-title">Title</label>
              <input id="kb-title" className="form-input" value={entryTitle} onChange={e => setEntryTitle(e.target.value)} placeholder="What did you learn?" autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="kb-content">Notes</label>
              <textarea id="kb-content" className="form-input" value={entryContent} onChange={e => setEntryContent(e.target.value)} placeholder="Write your notes, key takeaways, or explanations..." style={{ minHeight: 120 }} />
            </div>

            {/* Sources */}
            <div className="form-group">
              <label>Sources</label>
              {entrySources.map((src, idx) => (
                <div key={idx} className="kb-source-row">
                  <select className="form-select" style={{ width: 120 }} value={src.type} onChange={e => updateSource(idx, { type: e.target.value as KnowledgeSource['type'] })}>
                    <option value="quran">Quran</option>
                    <option value="hadith">Hadith</option>
                    <option value="scholarly">Scholarly</option>
                    <option value="other">Other</option>
                  </select>
                  {src.type === 'quran' && (
                    <>
                      <input className="form-input" style={{ width: 70 }} type="number" placeholder="Surah" value={src.surah || ''} onChange={e => updateSource(idx, { surah: parseInt(e.target.value) || undefined })} />
                      <input className="form-input" style={{ width: 90 }} placeholder="Ayah(s)" value={src.ayahStart ? (src.ayahEnd && src.ayahEnd !== src.ayahStart ? `${src.ayahStart}-${src.ayahEnd}` : `${src.ayahStart}`) : ''} onChange={e => {
                        const v = e.target.value;
                        if (v.includes('-')) {
                          const [start, end] = v.split('-');
                          updateSource(idx, { ayahStart: parseInt(start) || undefined, ayahEnd: parseInt(end) || undefined });
                        } else {
                          updateSource(idx, { ayahStart: parseInt(v) || undefined, ayahEnd: undefined });
                        }
                      }} />
                    </>
                  )}
                  {src.type === 'hadith' && (
                    <>
                      <select className="form-select" style={{ width: 130 }} value={src.collection || ''} onChange={e => updateSource(idx, { collection: e.target.value })}>
                        <option value="">Collection...</option>
                        {HADITH_COLLECTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input className="form-input" style={{ width: 90 }} placeholder="Number" value={src.hadithNumber || ''} onChange={e => updateSource(idx, { hadithNumber: e.target.value })} />
                    </>
                  )}
                  {src.type === 'scholarly' && (
                    <>
                      <input className="form-input" style={{ flex: 1 }} placeholder="Author" value={src.author || ''} onChange={e => updateSource(idx, { author: e.target.value })} />
                      <input className="form-input" style={{ flex: 1 }} placeholder="Title" value={src.title || ''} onChange={e => updateSource(idx, { title: e.target.value })} />
                    </>
                  )}
                  {src.type === 'other' && (
                    <input className="form-input" style={{ flex: 1 }} placeholder="Description" value={src.title || ''} onChange={e => updateSource(idx, { title: e.target.value })} />
                  )}
                  <button className="btn-icon btn-sm" onClick={() => removeSource(idx)} aria-label="Remove source" style={{ color: '#ff6b6b' }}>&times;</button>
                </div>
              ))}
              <div className="actions-row" style={{ marginTop: 6 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => addSource('quran')}>+ Quran</button>
                <button className="btn btn-secondary btn-sm" onClick={() => addSource('hadith')}>+ Hadith</button>
                <button className="btn btn-secondary btn-sm" onClick={() => addSource('scholarly')}>+ Scholarly</button>
              </div>
            </div>

            {/* Tags */}
            <div className="form-group">
              <label>Tags</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {entryTags.map(t => (
                  <span key={t} className="tag tag-daily" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px' }}>
                    {t}
                    <button style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', padding: 0, fontSize: 12 }} onClick={() => setEntryTags(prev => prev.filter(x => x !== t))}>&times;</button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="form-input" style={{ maxWidth: 200 }} placeholder="Add tag..." value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}
                  list="kb-tag-suggestions"
                />
                <datalist id="kb-tag-suggestions">
                  {allTags.filter(t => !entryTags.includes(t)).map(t => <option key={t} value={t} />)}
                </datalist>
                <button className="btn btn-secondary btn-sm" onClick={addTag} disabled={!tagInput.trim()}>Add</button>
              </div>
            </div>

            <div className="actions-row" style={{ marginTop: 16, gap: 8 }}>
              <button className="btn btn-primary" onClick={() => saveEntry(false)} disabled={!entryTitle.trim() || !entryTopicId}>
                {editingEntry ? 'Save' : 'Save'}
              </button>
              {!editingEntry && (
                <button className="btn btn-secondary" onClick={() => saveEntry(true)} disabled={!entryTitle.trim() || !entryTopicId}>
                  Save & Add Another
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => { resetEntryForm(); setTab('browse'); }}>Cancel</button>
            </div>
          </div>
        )}

        {/* ══ Search Tab ══ */}
        {tab === 'search' && (
          <>
            <input className="form-input" style={{ fontSize: 15, padding: '10px 14px', marginBottom: 12 }} placeholder="Search entries..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} autoFocus />
            <div className="filter-bar">
              {(['all', 'quran', 'hadith', 'scholarly', 'other'] as SourceFilter[]).map(f => (
                <button key={f} className={`btn btn-sm ${searchSourceFilter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSearchSourceFilter(f)}>
                  {f === 'all' ? 'All Sources' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
              <select className="form-select" style={{ minWidth: 140 }} value={searchTopicFilter} onChange={e => setSearchTopicFilter(e.target.value)}>
                <option value="all">All Topics</option>
                {sortedKnowledgeTopics.map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
              </select>
              {(searchQuery || searchSourceFilter !== 'all' || searchTopicFilter !== 'all') && (
                <span className="count" style={{ marginLeft: 'auto' }}>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</span>
              )}
            </div>

            {!searchQuery && searchSourceFilter === 'all' && searchTopicFilter === 'all' ? (
              <div className="empty-state" role="status">
                <div className="empty-icon" style={{ fontSize: 36 }}>{'\u{1F50D}'}</div>
                <h3>Search your knowledge</h3>
                <p>Search across all entries by title, content, source references, or tags.</p>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="empty-state" role="status">
                <div className="empty-icon" style={{ fontSize: 36 }}>{'\u{1F50D}'}</div>
                <h3>No results</h3>
                <p>Try different keywords or adjust your filters.</p>
              </div>
            ) : searchResults.map(e => renderEntryCard(e, true))}
          </>
        )}
        {/* ══ Lifestyle Tab ══ */}
        {tab === 'lifestyle' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
              {LIFESTYLE_COLUMNS.map(col => {
                const items = itemsByType[col.type];
                const isPractice = PRACTICE_TYPES.includes(col.type);
                const statuses = isPractice ? HALAL_STATUSES : AVOID_STATUSES;
                return (
                  <div key={col.type} onDragOver={handleDragOver} onDrop={e => handleColumnDrop(col.type, e)} style={{ minHeight: 100 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <h3 style={{ margin: 0, fontSize: 13, color: col.color }}>{col.emoji} {col.title}</h3>
                      <button className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => openAddLifestyle(col.type)}>+</button>
                    </div>
                    {items.length === 0 ? (
                      <div className="empty-state" role="status" style={{ padding: '20px 8px' }}>
                        <div className="empty-icon" style={{ fontSize: 22 }}>{col.emoji}</div>
                        <h3 style={{ fontSize: 11 }}>No items</h3>
                        <button className="btn btn-secondary btn-sm" style={{ fontSize: 10 }} onClick={() => openAddLifestyle(col.type)}>+ Add</button>
                      </div>
                    ) : (
                      items.map(item => {
                        const info = getStatusInfo(item.type, item.status);
                        return (
                          <div key={item.id} className={`ls-item ${dragId === item.id ? 'dragging' : ''}`} style={{ borderLeftColor: info.color }}
                            draggable onDragStart={() => handleDragStart(item.id)} onDragOver={handleDragOver} onDrop={() => handleDrop(item.id, col.type)}>
                            <button className="ls-status-btn" onClick={() => cycleStatus(item)} title={`Status: ${info.label}. Click to change.`} style={{ color: info.color }}>
                              {info.emoji}
                            </button>
                            <div className="ls-item-content">
                              <div className="ls-item-title">{item.title}</div>
                              <div className="ls-item-status" style={{ color: info.color }}>{info.label}</div>
                              {item.notes && <div className="ls-item-notes">{item.notes}</div>}
                              {item.sources && item.sources.length > 0 && (
                                <div className="ls-item-source">{item.sources.map((s, i) => <span key={i}>{i > 0 && ' · '}{renderSourceLink(s)}</span>)}</div>
                              )}
                            </div>
                            <div className="ls-item-actions">
                              <button className="btn-icon btn-sm" onClick={() => openEditLifestyle(item)} style={{ fontSize: 10 }}>Edit</button>
                              {deletingLifestyleId === item.id ? (
                                <div className="confirm-bar" role="alert" style={{ margin: 0, padding: '2px 4px', fontSize: 9 }}>
                                  <button className="btn btn-danger btn-sm" style={{ fontSize: 9, padding: '1px 4px' }} onClick={() => { knowledge.removeLifestyleItem(item.id); setDeletingLifestyleId(null); }}>Yes</button>
                                  <button className="btn btn-secondary btn-sm" style={{ fontSize: 9, padding: '1px 4px' }} onClick={() => setDeletingLifestyleId(null)}>No</button>
                                </div>
                              ) : (
                                <button className="btn-icon btn-sm" onClick={() => setDeletingLifestyleId(item.id)} style={{ fontSize: 10, color: '#ff6b6b' }}>&times;</button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                    {items.length > 0 && (
                      <div className="ls-summary" style={{ flexDirection: 'column', gap: 2 }}>
                        {statuses.map(s => (
                          <span key={s.value}>{s.emoji} {s.label}: {items.filter(i => i.status === s.value).length}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Lifestyle Add/Edit Modal */}
            {showLifestyleForm && (
              <div className="modal-overlay" onClick={() => setShowLifestyleForm(false)}>
                <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={editingLifestyle ? 'Edit Item' : 'Add Item'}>
                  <h2>{editingLifestyle ? 'Edit' : 'Add'} {LIFESTYLE_COLUMNS.find(c => c.type === lsType)?.title || 'Item'}</h2>
                  <div className="form-group">
                    <label htmlFor="ls-title">What is it?</label>
                    <input id="ls-title" className="form-input" value={lsTitle} onChange={e => setLsTitle(e.target.value)} placeholder={lsType === 'haram' ? 'e.g., Backbiting, Riba...' : 'e.g., Daily Salah, Charity...'} autoFocus />
                  </div>
                  <div className="form-group">
                    <label htmlFor="ls-status">Current status</label>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(PRACTICE_TYPES.includes(lsType) ? HALAL_STATUSES : AVOID_STATUSES).map(s => (
                        <button
                          key={s.value}
                          className={`btn btn-sm ${lsStatus === s.value ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setLsStatus(s.value)}
                          style={lsStatus === s.value ? { borderColor: s.color, background: s.color + '33' } : {}}
                        >
                          {s.emoji} {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="ls-notes">Notes (optional)</label>
                    <textarea id="ls-notes" className="form-input" value={lsNotes} onChange={e => setLsNotes(e.target.value)} placeholder="Why is this important to you? Any context..." />
                  </div>
                  <div className="form-group">
                    <label>Sources / References (optional)</label>
                    {lsSources.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                        {lsSources.map((s, i) => (
                          <span key={i} className="tag tag-daily" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px' }}>
                            {s}
                            <button style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', padding: 0, fontSize: 12 }} onClick={() => setLsSources(prev => prev.filter((_, idx) => idx !== i))}>&times;</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input id="ls-source" className="form-input" value={lsNewSource} onChange={e => setLsNewSource(e.target.value)} placeholder="e.g., Quran 2:275, Bukhari 1234"
                        onKeyDown={e => { if (e.key === 'Enter' && lsNewSource.trim()) { e.preventDefault(); setLsSources(prev => [...prev, lsNewSource.trim()]); setLsNewSource(''); } }}
                      />
                      <button className="btn btn-secondary btn-sm" disabled={!lsNewSource.trim()} onClick={() => { setLsSources(prev => [...prev, lsNewSource.trim()]); setLsNewSource(''); }}>Add</button>
                    </div>
                  </div>
                  <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={() => setShowLifestyleForm(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={saveLifestyle} disabled={!lsTitle.trim()}>
                      {editingLifestyle ? 'Save' : 'Add'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ══ Topic Modal ══ */}
      {showTopicModal && (
        <div className="modal-overlay" onClick={() => setShowTopicModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={editingTopic ? 'Edit Topic' : 'Add Topic'}>
            <h2>{editingTopic ? 'Edit Topic' : 'Add Topic'}</h2>
            <div className="form-group">
              <label htmlFor="kb-tname">Name</label>
              <input id="kb-tname" className="form-input" value={topicName} onChange={e => setTopicName(e.target.value)} placeholder="e.g., Pillars of Islam" autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="kb-tdesc">Description (optional)</label>
              <textarea id="kb-tdesc" className="form-input" value={topicDesc} onChange={e => setTopicDesc(e.target.value)} placeholder="What does this topic cover?" />
            </div>
            <div className="form-group">
              <label>Icon</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {TOPIC_ICONS.map(em => (
                  <button key={em} type="button" onClick={() => setTopicIcon(em)} style={{
                    fontSize: 22, padding: '4px 6px', background: topicIcon === em ? '#1e2140' : 'transparent',
                    border: topicIcon === em ? '1px solid #4f5bff' : '1px solid transparent', borderRadius: 6, cursor: 'pointer',
                  }}>{em}</button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>Color</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {TOPIC_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setTopicColor(c)} style={{
                    width: 24, height: 24, borderRadius: 4, background: c, border: topicColor === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', padding: 0,
                  }} />
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowTopicModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveTopic} disabled={!topicName.trim()}>
                {editingTopic ? 'Save' : 'Create Topic'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
