import { useCallback } from 'react';
import { ProjectCatalogueSectionView } from './ProjectCatalogueSectionView';
import type { ProjectCatalogueState } from './useProjectCatalogue';
import { useProjectContext } from '../../store/contexts/ProjectContext';
import { useTaskContext } from '../../store/contexts/TaskContext';
import {
  PROJECT_CATALOG_FILTERS,
  PROJECT_KIND_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  countActiveProjectWork,
  countLiveProjects,
  getProjectStatusLabel,
  type ProjectCatalogueFilters,
} from '../../services/projectModel';
import type { Project, ProjectCatalogueSection } from '../../types/domain';

const SECTION_COPY: Record<ProjectCatalogueSection, { title: string; description: string }> = {
  pinned: { title: 'Pinned', description: 'Your quickest access to priority projects.' },
  projects: { title: 'Projects', description: 'Active, planned, blocked, and completed work.' },
  archived: { title: 'Archived', description: 'Out of the way, but always recoverable.' },
};

/** The reference catalogue: summary, filters, and the Pinned, Projects, and Archived sections. */
export function ProjectCatalogueView({
  catalogue,
  onOpen,
}: {
  catalogue: ProjectCatalogueState;
  onOpen: (project: Project) => void;
}) {
  const { projects } = useProjectContext();
  const { tasks } = useTaskContext();
  const { filters, updateFilters, clearFilters, isFiltered, filteredProjects, groupedProjects, availableTags } = catalogue;
  const getActiveWorkCount = useCallback((projectId: string) => countActiveProjectWork(tasks, projectId), [tasks]);

  function renderSection(section: ProjectCatalogueSection, collapsible = false) {
    return (
      <ProjectCatalogueSectionView
        section={section}
        title={SECTION_COPY[section].title}
        description={SECTION_COPY[section].description}
        projects={groupedProjects[section]}
        collapsed={collapsible ? !catalogue.archivedExpanded : false}
        collapsible={collapsible}
        reorderEnabled={!isFiltered}
        onToggleCollapsed={collapsible ? catalogue.toggleArchived : undefined}
        getActiveWorkCount={getActiveWorkCount}
        onOpen={onOpen}
        onPinChange={(project, pinned) => catalogue.changePinned(project, pinned)}
        onArchiveChange={(project, archived) => catalogue.changeArchived(project, archived)}
        onReorder={catalogue.reorder}
        onAnnounce={catalogue.announce}
      />
    );
  }

  return (
    <div className="projects-catalog-shell">
      <section className="projects-catalog-intro" aria-labelledby="projects-catalog-title">
        <div>
          <h2 id="projects-catalog-title">Your work, easy to find again.</h2>
          <p>
            Keep account-backed project references, live links, setup notes, and planning work together.
            Sabah One keeps the reference visible without turning every project into a task board.
          </p>
        </div>
        <div className="projects-catalog-stats" aria-label="Project catalogue summary">
          <div className="projects-catalog-stat"><strong>{projects.length}</strong><span>Projects</span></div>
          <div className="projects-catalog-stat"><strong>{countLiveProjects(projects)}</strong><span>Live</span></div>
        </div>
      </section>

      <section className="projects-catalog-toolbar" aria-label="Filter projects">
        <div className="projects-catalog-search-row">
          <label className="project-filter-field">
            <span>Search projects</span>
            <input
              className="form-input"
              value={filters.query}
              onChange={event => updateFilters({ query: event.target.value })}
              placeholder="Projects, links, tags, or summaries"
            />
          </label>
          <label className="project-filter-field">
            <span>Type</span>
            <select className="form-select" value={filters.kind} onChange={event => updateFilters({ kind: event.target.value as ProjectCatalogueFilters['kind'] })}>
              <option value="all">All project types</option>
              {PROJECT_KIND_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="project-filter-field">
            <span>Status</span>
            <select className="form-select" value={filters.status} onChange={event => updateFilters({ status: event.target.value as ProjectCatalogueFilters['status'] })}>
              <option value="all">All statuses</option>
              {PROJECT_STATUS_OPTIONS.map(status => (
                <option key={status} value={status}>{getProjectStatusLabel(status)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="projects-filter-chips" aria-label="Quick project filters">
          {PROJECT_CATALOG_FILTERS.map(filter => (
            <button
              key={filter.value}
              className={`project-filter-chip ${filters.catalog === filter.value ? 'active' : ''}`}
              type="button"
              aria-pressed={filters.catalog === filter.value}
              onClick={() => updateFilters({ catalog: filter.value })}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {availableTags.length > 0 && (
          <label className="project-filter-field project-tag-filter">
            <span>Tag</span>
            <select className="form-select" value={filters.tag} onChange={event => updateFilters({ tag: event.target.value })}>
              <option value="all">All tags</option>
              {availableTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
            </select>
          </label>
        )}
      </section>

      <section className="project-catalog-results">
        <div className="project-catalog-results-header">
          <div>
            <h2>{filters.catalog === 'all' ? 'Project catalogue' : PROJECT_CATALOG_FILTERS.find(filter => filter.value === filters.catalog)?.label}</h2>
            {isFiltered && (
              <button type="button" className="project-reorder-filter-note" onClick={clearFilters}>
                Clear filters to reorder
              </button>
            )}
          </div>
          <span role="status" aria-live="polite" aria-atomic="true">
            {filteredProjects.length} result{filteredProjects.length === 1 ? '' : 's'}
          </span>
        </div>
        <p id="project-reorder-instructions" className="project-sr-only">
          Use the Reorder button to move this project. Press Space or Enter to pick it up,
          use the arrow keys to change its position, then press Space or Enter to drop.
          Press Escape to cancel.
        </p>
        <div className="project-sr-only" role="status" aria-live="assertive" aria-atomic="true">
          {catalogue.announcement}
        </div>
        {filteredProjects.length > 0 ? (
          <div className="project-catalog-sections">
            {groupedProjects.pinned.length > 0 && renderSection('pinned')}
            {groupedProjects.projects.length > 0 && renderSection('projects')}
            {renderSection('archived', true)}
          </div>
        ) : (
          <div className="project-empty-filter" role="status">
            <div>
              <strong>No projects match these filters.</strong>
              <p>Clear the search or choose All to see the complete catalogue.</p>
              <button className="btn btn-secondary btn-sm" type="button" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
