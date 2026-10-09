import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { VOICE, VOICE_ACTIONS, cleanVoiceCommand, isVoiceCancel, isVoiceConfirm, type VoiceDecision, type VoiceInput, type VoiceItem } from '../../supabase/functions/_shared/jevVoice';
import { useShell } from '../store/ShellContext';
import { useTaskContext } from '../store/contexts/TaskContext';
import { useInventoryContext } from '../store/contexts/InventoryContext';
import { useProjectContext } from '../store/contexts/ProjectContext';
import { useKnowledgeContext } from '../store/contexts/KnowledgeContext';
import { useSettingsContext } from '../store/contexts/SettingsContext';
import { useGamificationContext } from '../store/contexts/GamificationContext';
import { useSyncAvailability } from '../store/SyncAvailabilityContext';
import { completeTask, saveTask } from '../services/backend/plannerServiceApi';
import { decideVoiceCommand } from '../services/jevVoiceApi';

const TASK_DEFAULTS = { description: '', priority: 'medium', category: 'task' } as const;
const PRAYER_CATEGORY = 'prayer';
const MIN_MATCH_WORD_LENGTH = 3;

interface PendingVoiceWrite { action: 'add_task' | 'complete_task'; id: string; title: string; }

export function useJevVoiceWorkflow() {
  const shell = useShell();
  const tasks = useTaskContext();
  const inventory = useInventoryContext();
  const projects = useProjectContext();
  const knowledge = useKnowledgeContext();
  const settings = useSettingsContext();
  const gamification = useGamificationContext();
  const sync = useSyncAvailability();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Ready for a command.');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingVoiceWrite | null>(null);
  const [found, setFound] = useState<VoiceItem | null>(null);
  const [measurement, setMeasurement] = useState<VoiceDecision | null>(null);
  const current = useRef({ shell, tasks, inventory, projects, knowledge, settings, gamification, sync, pending });
  const active = useRef(true);
  const locked = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => { current.current = { shell, tasks, inventory, projects, knowledge, settings, gamification, sync, pending }; });
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); };
  }, []);

  const cancel = useCallback(() => {
    controller.current?.abort();
    generation.current++;
    setPending(null);
    setFound(null);
    setNotice(locked.current ? 'Stopped listening. A request already sent may still finish; check Tasks.' : 'Command cancelled.');
  }, []);

  const confirm = useCallback(async () => {
    const state = current.current;
    const write = state.pending;
    if (!write || locked.current || state.sync.readOnly || state.shell.surface === 'secrets') return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setNotice('Waiting for Sabah One to save…');
    setPending(null);
    try {
      if (write.action === VOICE_ACTIONS.add) {
        const saved = await saveTask(write.id, { ...TASK_DEFAULTS, title: write.title });
        if (!active.current) return;
        current.current.tasks.applyTask(saved);
        setNotice(`Added task: ${saved.title}`);
      } else {
        const task = state.tasks.tasks.find(task => task.id === write.id);
        if (!task || task.completed || task.category === PRAYER_CATEGORY || state.tasks.error) throw new Error('That task changed or is unavailable. Find it again before completing.');
        const saved = await completeTask(write.id, state.settings.appTimeZone.effectiveTimeZone);
        if (!active.current) return;
        current.current.tasks.applyTask(saved.task);
        current.current.gamification.applyProfile(saved.profile);
        setNotice(`Completed task: ${saved.task.title}`);
      }
      current.current.shell.requestNavigation({ surface: 'tasks', surfaceState: { tasks: { tab: 'all', resetFilters: true } } });
    } catch (writeError) {
      if (active.current) {
        setError(writeError instanceof Error ? writeError.message : 'The task change was not confirmed.');
        setNotice('Save was not confirmed. Check Tasks before repeating the command.');
        void current.current.tasks.reload();
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }, []);

  const run = useCallback(async (spoken: string, secretId: string) => {
    if (isVoiceCancel(spoken)) { cancel(); return; }
    if (isVoiceConfirm(spoken)) { await confirm(); return; }
    const state = current.current;
    if (locked.current) return;
    if (!secretId) { setError('Choose a TypeSafe API key from your Vault first.'); return; }
    if (state.sync.readOnly || state.shell.surface === 'secrets') { setError('Voice commands are paused while offline or viewing Secrets.'); return; }
    if (!state.tasks.loaded || !state.inventory.loaded || !state.projects.loaded || !state.knowledge.loaded) {
      setError('Wait for page data to load, then retry the command.'); return;
    }
    const allItems: VoiceItem[] = [
      ...state.tasks.tasks.map(task => ({ id: `tasks:${task.id}`, label: task.title, page: 'tasks' as const,
        canComplete: !state.tasks.error && !task.completed && task.category !== PRAYER_CATEGORY })),
      ...state.inventory.inventoryItems.map(item => ({ id: `inventory:${item.id}`, label: item.name, page: 'inventory' as const, canComplete: false })),
      ...state.projects.projects.map(project => ({ id: `projects:${project.id}`, label: project.name, page: 'projects' as const, canComplete: false })),
      ...state.knowledge.knowledgeEntries.map(entry => ({ id: `knowledge:${entry.id}`, label: entry.title, page: 'knowledge' as const, canComplete: false })),
    ];
    // Keep matching names first when a catalogue exceeds the request cap; never silently invent missing items.
    const transcript = cleanVoiceCommand(spoken);
    const words = transcript.toLowerCase().split(/\s+/);
    const score = (item: VoiceItem) => words.filter(word => word.length >= MIN_MATCH_WORD_LENGTH && item.label.toLowerCase().includes(word)).length;
    const items = allItems.sort((left, right) => score(right) - score(left)).slice(0, VOICE.maxItems)
      .map(item => ({ ...item, label: item.label.slice(0, VOICE.maxLabel) }));
    const input: VoiceInput = { transcript, page: state.shell.surface, items };
    const request = new AbortController();
    controller.current = request;
    const revision = ++generation.current;
    locked.current = true;
    setBusy(true);
    setError(null);
    setPending(null);
    setFound(null);
    setNotice('Jev is choosing the action…');
    try {
      const decision = await decideVoiceCommand(secretId, input, request.signal);
      if (!active.current || request.signal.aborted || revision !== generation.current || current.current.sync.readOnly
        || current.current.shell.surface === 'secrets') return;
      setMeasurement(decision);
      if (decision.action === VOICE_ACTIONS.none || !decision.confident) { setNotice('No clear supported command. Try one page or one item by name.'); return; }
      if (decision.action === VOICE_ACTIONS.navigate && decision.page) {
        current.current.shell.navigate(decision.page);
        setNotice(`Opened ${decision.page}.`);
      } else if (decision.action === VOICE_ACTIONS.find && decision.itemId) {
        const item = allItems.find(candidate => candidate.id === decision.itemId);
        if (item) { setFound(item); current.current.shell.navigate(item.page); setNotice(`Found ${item.label} in ${item.page}.`); }
      } else if (decision.action === VOICE_ACTIONS.add && decision.text) {
        setPending({ action: VOICE_ACTIONS.add, id: uuid(), title: decision.text });
        setNotice('Review the task, then say confirm over or press Confirm.');
      } else if (decision.action === VOICE_ACTIONS.complete && decision.itemId) {
        const item = allItems.find(candidate => candidate.id === decision.itemId && candidate.canComplete);
        if (item) { setPending({ action: VOICE_ACTIONS.complete, id: item.id.slice('tasks:'.length), title: item.label }); setNotice('Review the task, then say confirm over or press Confirm.'); }
      }
    } catch (requestError) {
      if (active.current && !request.signal.aborted && revision === generation.current) {
        setError(requestError instanceof Error ? requestError.message : 'Jev could not finish the command.');
        setNotice('Nothing was changed.');
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }, [cancel, confirm]);

  return { run, confirm, cancel, busy, notice, error, pending, found, measurement, readOnly: sync.readOnly };
}
