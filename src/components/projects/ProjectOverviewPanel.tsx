import { MetricCard } from '../common/MetricCard';
import {
  formatProjectTimestamp,
  type ProjectActivityItem,
  type ProjectWorkSummary,
} from '../../services/projectModel';
import type { Project, Task } from '../../types/domain';

const MILESTONE_SNAPSHOT_LIMIT = 4;

/** Work metrics, reference links, milestone snapshot, and recent activity. */
export function ProjectOverviewPanel({
  project,
  milestones,
  summary,
  recentActivity,
}: {
  project: Project;
  milestones: Task[];
  summary: ProjectWorkSummary;
  recentActivity: ProjectActivityItem[];
}) {
  const links = project.links || [];

  return (
    <div id="project-panel-overview" role="tabpanel" aria-labelledby="project-tab-overview" tabIndex={0} style={{ display: 'grid', gap: 16 }}>
      <div className="projects-metrics-grid">
        <MetricCard label="Open Work" value={String(summary.openCount)} note="Incomplete tasks and milestones linked to this project." />
        <MetricCard label="Blocked" value={String(summary.blockedCount)} note="Kanban cards sitting in the blocked lane." />
        <MetricCard label="Overdue" value={String(summary.overdueCount)} note="Linked work with due dates before today." />
        <MetricCard label="Completed" value={String(summary.completedCount)} note="Work already finished inside this project." />
      </div>

      <div className="project-detail-grid">
        <div className="card" style={{ padding: 18, display: 'grid', gap: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Project References</div>
          <div style={{ fontSize: 13, color: '#8b8fa3' }}>
            Open the account-backed web links and keep setup guidance with the project.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {links.filter(link => link.url).map(link => (
              <a key={link.id} className="btn btn-secondary btn-sm" href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
            {links.length === 0 && (
              <span style={{ fontSize: 12, color: '#6b6f85' }}>No web links recorded yet.</span>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Milestone Snapshot</div>
          <div style={{ fontSize: 13, color: '#8b8fa3' }}>
            {summary.milestoneCount === 0
              ? 'No milestones yet. Use project-linked goals to mark major outcomes.'
              : `${summary.completedMilestoneCount} of ${summary.milestoneCount} milestones completed.`}
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {milestones.slice(0, MILESTONE_SNAPSHOT_LIMIT).map(goal => (
              <div key={goal.id} style={{ padding: 12, borderRadius: 12, background: '#141926', border: '1px solid #23283c' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontWeight: 600, color: '#f5f7ff' }}>{goal.title}</div>
                  <span className={`tag ${goal.completed ? 'tag-connected' : 'tag-primary'}`}>{goal.completed ? 'Done' : 'Active'}</span>
                </div>
                <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>
                  {goal.dueDate ? `Target ${goal.dueDate}` : 'No target date'}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Recent Activity</div>
          {recentActivity.length === 0 ? (
            <div style={{ fontSize: 13, color: '#8b8fa3' }}>No recent task or wiki updates yet.</div>
          ) : (
            recentActivity.map(item => (
              <div key={`${item.type}-${item.id}`} style={{ padding: 12, borderRadius: 12, background: '#141926', border: '1px solid #23283c' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontWeight: 600 }}>{item.label}</div>
                  <span className="tag tag-disconnected">{item.type === 'task' ? 'Task' : 'Wiki'}</span>
                </div>
                <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>{formatProjectTimestamp(item.updatedAt)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
