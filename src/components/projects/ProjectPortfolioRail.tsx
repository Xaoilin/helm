import { ProjectStatusPill } from './ProjectStatusPill';
import type { ProjectCatalogueState } from './useProjectCatalogue';
import { useTaskContext } from '../../store/contexts/TaskContext';
import {
  PROJECT_STATUS_OPTIONS,
  countActiveProjectWork,
  getProjectStatusLabel,
  type ProjectCatalogueFilters,
} from '../../services/projectModel';
import type { Project } from '../../types/domain';

/** The management workspace's project list, grouped by pin and status. */
export function ProjectPortfolioRail({
  catalogue,
  selectedProjectId,
  onSelect,
  onQuickAdd,
}: {
  catalogue: ProjectCatalogueState;
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
  onQuickAdd: () => void;
}) {
  const { filters, updateFilters, availableTags, groupedProjects, filteredProjects } = catalogue;

  return (
    <aside className="card" style={{ padding: 18, display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gap: 10 }}>
        <input
          className="form-input"
          value={filters.query}
          onChange={event => updateFilters({ query: event.target.value })}
          placeholder="Search projects, tags, or summaries"
          aria-label="Search projects"
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <select className="form-select" value={filters.status} onChange={event => updateFilters({ status: event.target.value as ProjectCatalogueFilters['status'] })}>
            <option value="all">All statuses</option>
            {PROJECT_STATUS_OPTIONS.map(status => (
              <option key={status} value={status}>{getProjectStatusLabel(status)}</option>
            ))}
          </select>
          <select className="form-select" value={filters.tag} onChange={event => updateFilters({ tag: event.target.value })}>
            <option value="all">All tags</option>
            {availableTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </div>
        <button className="btn btn-secondary" onClick={onQuickAdd}>Quick add project</button>
      </div>

      <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        <RailGroup title="Pinned" projects={groupedProjects.pinned} selectedProjectId={selectedProjectId} onSelect={onSelect} />
        <RailGroup title="Active Portfolio" projects={groupedProjects.active} selectedProjectId={selectedProjectId} onSelect={onSelect} />
        <RailGroup title="Blocked" projects={groupedProjects.blocked} selectedProjectId={selectedProjectId} onSelect={onSelect} />
        <RailGroup title="Archived" projects={groupedProjects.archived} selectedProjectId={selectedProjectId} onSelect={onSelect} />
        {filteredProjects.length === 0 && (
          <div style={{ fontSize: 13, color: '#8b8fa3' }}>
            No projects match the current filters.
          </div>
        )}
      </div>
    </aside>
  );
}

function RailGroup({
  title,
  projects,
  selectedProjectId,
  onSelect,
}: {
  title: string;
  projects: Project[];
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
}) {
  const { tasks } = useTaskContext();
  if (projects.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7, color: '#6b6f85' }}>{title}</div>
      {projects.map(project => {
        const activeCount = countActiveProjectWork(tasks, project.id);
        const selected = selectedProjectId === project.id;
        return (
          <button
            key={project.id}
            type="button"
            onClick={() => onSelect(project.id)}
            style={{
              textAlign: 'left',
              padding: 14,
              borderRadius: 14,
              border: selected ? '1px solid #4f5bff' : '1px solid #23283c',
              background: selected ? 'rgba(79, 91, 255, 0.12)' : '#121620',
              color: '#f5f7ff',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{project.name}</div>
              {project.isPinned && <span style={{ color: '#fbbf24', fontSize: 13 }}>Pinned</span>}
            </div>
            <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>
              {project.summary || 'No summary yet.'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <ProjectStatusPill status={project.status} />
              <span style={{ fontSize: 12, color: '#8b8fa3' }}>{activeCount} active item{activeCount === 1 ? '' : 's'}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
