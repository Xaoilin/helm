import {
  DragDropProvider,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/react';
import { arrayMove } from '@dnd-kit/helpers';
import { isSortable } from '@dnd-kit/react/sortable';
import { ProjectCard, type ProjectMoveDirection } from './ProjectCatalog';
import type { Project, ProjectCatalogueSection } from '../../types/domain';

/**
 * One catalogue section (Pinned, Projects, or Archived) with drag-and-drop and
 * keyboard reordering. Every order change and outcome is announced.
 */
export function ProjectCatalogueSectionView({
  section,
  title,
  description,
  projects,
  collapsed = false,
  collapsible = false,
  reorderEnabled,
  onToggleCollapsed,
  getActiveWorkCount,
  onOpen,
  onPinChange,
  onArchiveChange,
  onReorder,
  onAnnounce,
}: {
  section: ProjectCatalogueSection;
  title: string;
  description: string;
  projects: Project[];
  collapsed?: boolean;
  collapsible?: boolean;
  reorderEnabled: boolean;
  onToggleCollapsed?: () => void;
  getActiveWorkCount: (projectId: string) => number;
  onOpen: (project: Project) => void;
  onPinChange: (project: Project, pinned: boolean) => void;
  onArchiveChange: (project: Project, archived: boolean) => void;
  onReorder: (section: ProjectCatalogueSection, orderedIds: string[]) => void;
  onAnnounce: (message: string) => void;
}) {
  const sectionTitleId = `project-section-${section}-title`;
  const sectionGridId = `project-section-${section}-grid`;
  const orderedIds = projects.map(project => project.id);

  function moveProject(project: Project, direction: ProjectMoveDirection): void {
    const currentIndex = orderedIds.indexOf(project.id);
    const nextIndex = direction === 'earlier' ? currentIndex - 1 : currentIndex + 1;
    if (!reorderEnabled || currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedIds.length) return;
    onReorder(section, arrayMove(orderedIds, currentIndex, nextIndex));
    onAnnounce(`${project.name} moved to position ${nextIndex + 1} of ${orderedIds.length} in ${title}.`);
  }

  function handleDragStart(event: DragStartEvent): void {
    const sourceId = event.operation.source?.id;
    const sourceIndex = orderedIds.findIndex(id => id === String(sourceId));
    const sourceProject = projects[sourceIndex];
    if (sourceProject) {
      onAnnounce(`Picked up ${sourceProject.name}, position ${sourceIndex + 1} of ${projects.length} in ${title}.`);
    }
  }

  function handleDragEnd(event: DragEndEvent): void {
    const source = event.operation.source;
    if (!isSortable(source)) {
      onAnnounce('Project order was not changed.');
      return;
    }
    const sourceProject = projects.find(project => project.id === String(source.id));

    if (event.canceled) {
      if (sourceProject) onAnnounce(`Reordering ${sourceProject.name} cancelled.`);
      return;
    }
    if (
      !sourceProject
      || source.initialGroup !== section
      || source.group !== section
      || source.initialIndex < 0
      || source.index < 0
      || source.initialIndex >= orderedIds.length
      || source.index >= orderedIds.length
    ) {
      onAnnounce('Project order was not changed.');
      return;
    }
    if (source.initialIndex === source.index) {
      onAnnounce(`${sourceProject.name} remains at position ${source.index + 1} of ${projects.length}.`);
      return;
    }

    onReorder(section, arrayMove(orderedIds, source.initialIndex, source.index));
    onAnnounce(`${sourceProject.name} moved to position ${source.index + 1} of ${projects.length} in ${title}.`);
    requestAnimationFrame(() => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[data-project-drag-id]'))
        .find(button => button.dataset.projectDragId === sourceProject.id)
        ?.focus();
    });
  }

  return (
    <section className={`project-catalog-section project-catalog-section-${section}`} aria-labelledby={sectionTitleId}>
      <header className="project-catalog-section-header">
        <div>
          <div className="project-catalog-section-title-row">
            <h2 id={sectionTitleId}>{title}</h2>
            <span>{projects.length}</span>
          </div>
          <p>{description}</p>
        </div>
        {collapsible && (
          <button
            type="button"
            className="project-archive-disclosure"
            aria-expanded={!collapsed}
            aria-controls={sectionGridId}
            disabled={projects.length === 0}
            onClick={onToggleCollapsed}
          >
            {collapsed ? 'Show archived' : 'Hide archived'}
            <span aria-hidden="true" className={collapsed ? '' : 'is-open'}>⌄</span>
          </button>
        )}
      </header>

      <div id={sectionGridId} className="project-catalog-section-body" hidden={collapsed}>
        {!collapsed && projects.length > 0 && (
          <DragDropProvider onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="project-catalog-grid" role="list">
              {projects.map((project, index) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  activeWorkCount={getActiveWorkCount(project.id)}
                  section={section}
                  index={index}
                  sectionSize={projects.length}
                  reorderEnabled={reorderEnabled}
                  onOpen={onOpen}
                  onPinChange={pinned => onPinChange(project, pinned)}
                  onArchiveChange={archived => onArchiveChange(project, archived)}
                  onMove={direction => moveProject(project, direction)}
                />
              ))}
            </div>
          </DragDropProvider>
        )}
        {!collapsed && projects.length === 0 && (
          <p className="project-catalog-section-empty">
            {section === 'archived' ? 'No archived projects.' : `No ${title.toLowerCase()} in this view.`}
          </p>
        )}
      </div>
    </section>
  );
}
