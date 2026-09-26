import { useState } from 'react';
import { MetricCard } from '../common/MetricCard';
import { MilestoneEditorDialog } from './MilestoneEditorDialog';
import { useTaskContext } from '../../store/contexts/TaskContext';
import { priorityTagClass } from './priorityTagClass';
import {
  buildMilestone,
  formatProjectTimestamp,
  sortMilestones,
  type MilestoneDraft,
  type ProjectWorkSummary,
} from '../../services/projectModel';
import type { Project, Task } from '../../types/domain';

type MilestoneEditor = { milestone: Task | null } | null;

export function ProjectMilestonesPanel({
  project,
  milestones,
  summary,
}: {
  project: Project;
  milestones: Task[];
  summary: ProjectWorkSummary;
}) {
  const tasks = useTaskContext();
  const [editor, setEditor] = useState<MilestoneEditor>(null);

  function saveMilestone(draft: MilestoneDraft): void {
    const editing = editor?.milestone ?? null;
    const milestone = buildMilestone(draft, project.id, editing);
    if (!milestone) return;
    if (editing) tasks.updateTask(editing.id, milestone);
    else tasks.addTask(milestone);
    setEditor(null);
  }

  function toggleCompleted(goal: Task): void {
    tasks.updateTask(goal.id, {
      completed: !goal.completed,
      completedAt: goal.completed ? undefined : new Date().toISOString(),
    });
  }

  function removeMilestone(goal: Task): void {
    if (window.confirm(`Delete milestone "${goal.title}"?`)) tasks.removeTask(goal.id);
  }

  return (
    <div id="project-panel-milestones" role="tabpanel" aria-labelledby="project-tab-milestones" tabIndex={0} style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 18, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Project Milestones</div>
          <div style={{ fontSize: 13, color: '#8b8fa3' }}>
            Track major outcomes using project-linked goals so Tasks and Projects stay in sync.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setEditor({ milestone: null })}>+ Add Milestone</button>
      </div>

      <div className="projects-metrics-grid">
        <MetricCard label="Active Milestones" value={String(summary.activeMilestoneCount)} />
        <MetricCard label="Completed Milestones" value={String(summary.completedMilestoneCount)} />
        <MetricCard label="Progress" value={`${summary.milestoneProgress}%`} />
      </div>

      {milestones.length === 0 ? (
        <div className="empty-state" role="status">
          <div className="empty-icon">&#127919;</div>
          <h3>No milestones yet</h3>
          <p>Capture the big outcomes here, then drive the board work underneath them.</p>
          <button className="btn btn-primary" onClick={() => setEditor({ milestone: null })}>+ Add Milestone</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {sortMilestones(milestones).map(goal => (
            <div key={goal.id} className="card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, textDecoration: goal.completed ? 'line-through' : 'none' }}>{goal.title}</div>
                    <span className={`tag ${goal.completed ? 'tag-connected' : 'tag-primary'}`}>{goal.completed ? 'Done' : 'Active'}</span>
                    <span className={`tag ${priorityTagClass(goal.priority)}`}>{goal.priority}</span>
                  </div>
                  {goal.description && <div style={{ fontSize: 13, color: '#9ea4c5' }}>{goal.description}</div>}
                  <div style={{ fontSize: 12, color: '#8b8fa3' }}>
                    {goal.dueDate ? `Target date ${goal.dueDate}` : 'No target date'}
                    {goal.completedAt ? ` · Completed ${formatProjectTimestamp(goal.completedAt)}` : ''}
                  </div>
                </div>
                <div className="actions-row" style={{ margin: 0 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => toggleCompleted(goal)}>
                    {goal.completed ? 'Reopen' : 'Complete'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditor({ milestone: goal })}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => removeMilestone(goal)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editor && (
        <MilestoneEditorDialog milestone={editor.milestone} onSave={saveMilestone} onClose={() => setEditor(null)} />
      )}
    </div>
  );
}
