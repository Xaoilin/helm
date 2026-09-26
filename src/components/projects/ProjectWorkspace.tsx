import type { KeyboardEvent as ReactKeyboardEvent, Ref } from 'react';
import { ProjectBoardPanel } from './ProjectBoardPanel';
import { ProjectMilestonesPanel } from './ProjectMilestonesPanel';
import { ProjectOverviewPanel } from './ProjectOverviewPanel';
import { ProjectPortfolioRail } from './ProjectPortfolioRail';
import { ProjectStatusPill } from './ProjectStatusPill';
import { ProjectWikiPanel } from './ProjectWikiPanel';
import type { ProjectCatalogueState } from './useProjectCatalogue';
import { ProjectInventorySection } from '../../surfaces/InventorySurface';
import {
  PROJECT_TABS,
  buildProjectActivity,
  getNextProjectTab,
  resolvePageId,
  summarizeProjectWork,
  type ProjectTab,
  type ProjectWork,
} from '../../services/projectModel';
import type { Project, ProjectPage } from '../../types/domain';

/** The management workspace: portfolio rail beside the selected project's tabs. */
export function ProjectWorkspace({
  catalogue,
  project,
  work,
  pages,
  today,
  activeTab,
  onTabChange,
  pickedPageId,
  onPickPage,
  backButtonRef,
  onBack,
  onSelectProject,
  onQuickAdd,
  onEdit,
  onRemove,
}: {
  catalogue: ProjectCatalogueState;
  project: Project | null;
  work: ProjectWork;
  pages: ProjectPage[];
  /** Local `YYYY-MM-DD` key used for overdue work. */
  today: string;
  activeTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
  pickedPageId: string | null;
  onPickPage: (pageId: string) => void;
  backButtonRef: Ref<HTMLButtonElement>;
  onBack: () => void;
  onSelectProject: (projectId: string) => void;
  onQuickAdd: () => void;
  onEdit: (project: Project) => void;
  onRemove: (project: Project) => void;
}) {
  return (
    <>
      <div className="project-management-toolbar">
        <button ref={backButtonRef} type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
          ← Back to all projects
        </button>
        <span>Management workspace</span>
      </div>
      <div className="projects-layout project-management-layout">
        <ProjectPortfolioRail
          catalogue={catalogue}
          selectedProjectId={project?.id ?? null}
          onSelect={onSelectProject}
          onQuickAdd={onQuickAdd}
        />

        <section style={{ display: 'grid', gap: 16 }}>
          {project ? (
            <>
              <ProjectWorkspaceHeader project={project} activeTab={activeTab} onTabChange={onTabChange} onEdit={onEdit} onRemove={onRemove} />
              <ProjectTabPanel
                project={project}
                work={work}
                pages={pages}
                today={today}
                activeTab={activeTab}
                pickedPageId={pickedPageId}
                onPickPage={onPickPage}
              />
            </>
          ) : (
            <div className="card" style={{ padding: 20, color: '#8b8fa3' }}>
              Pick a project from the portfolio rail to open its board, milestones, and wiki.
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function ProjectWorkspaceHeader({
  project,
  activeTab,
  onTabChange,
  onEdit,
  onRemove,
}: {
  project: Project;
  activeTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
  onEdit: (project: Project) => void;
  onRemove: (project: Project) => void;
}) {
  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentTab: ProjectTab): void {
    const nextTab = getNextProjectTab(currentTab, event.key);
    if (!nextTab) return;
    event.preventDefault();
    onTabChange(nextTab);
    requestAnimationFrame(() => document.getElementById(`project-tab-${nextTab}`)?.focus());
  }

  return (
    <div className="card" style={{ padding: 20, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{project.name}</h2>
            <ProjectStatusPill status={project.status} />
            {project.isPinned && <span className="tag tag-primary">Pinned</span>}
          </div>
          <div style={{ color: '#9ea4c5', maxWidth: 760 }}>
            {project.summary || 'Add a short brief so the project overview explains what this workspace is for.'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {project.tags.length > 0 ? project.tags.map(tag => (
              <span key={tag} className="tag tag-connected">{tag}</span>
            )) : <span style={{ fontSize: 12, color: '#6b6f85' }}>No tags yet</span>}
          </div>
        </div>
        <div className="actions-row" style={{ margin: 0 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => onEdit(project)}>Edit Project</button>
          <button className="btn btn-danger btn-sm" onClick={() => onRemove(project)}>Remove</button>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label={`${project.name} management`}>
        {PROJECT_TABS.map(tab => (
          <button
            key={tab.key}
            id={`project-tab-${tab.key}`}
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`project-panel-${tab.key}`}
            tabIndex={activeTab === tab.key ? 0 : -1}
            onClick={() => onTabChange(tab.key)}
            onKeyDown={event => handleTabKeyDown(event, tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProjectTabPanel({
  project,
  work,
  pages,
  today,
  activeTab,
  pickedPageId,
  onPickPage,
}: {
  project: Project;
  work: ProjectWork;
  pages: ProjectPage[];
  today: string;
  activeTab: ProjectTab;
  pickedPageId: string | null;
  onPickPage: (pageId: string) => void;
}) {
  const summary = summarizeProjectWork(work, today);

  switch (activeTab) {
    case 'overview':
      return (
        <ProjectOverviewPanel
          project={project}
          milestones={work.milestones}
          summary={summary}
          recentActivity={buildProjectActivity(work.all, pages)}
        />
      );
    case 'board':
      return <ProjectBoardPanel project={project} boardTasks={work.board} />;
    case 'milestones':
      return <ProjectMilestonesPanel project={project} milestones={work.milestones} summary={summary} />;
    case 'wiki':
      return <ProjectWikiPanel project={project} pages={pages} selectedPageId={resolvePageId(pages, pickedPageId)} onSelectPage={onPickPage} />;
    case 'inventory':
      return (
        <div id="project-panel-inventory" role="tabpanel" aria-labelledby="project-tab-inventory" tabIndex={0}>
          <ProjectInventorySection
            catalogKey={project.catalogKey || `custom:${project.id}`}
            projectName={project.name}
          />
        </div>
      );
  }
}
