import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ProjectReferenceDrawer } from '../components/projects/ProjectCatalog';
import { ProjectCatalogueView } from '../components/projects/ProjectCatalogueView';
import { ProjectEditorDialog } from '../components/projects/ProjectEditorDialog';
import { ProjectWorkspace } from '../components/projects/ProjectWorkspace';
import { useProjectCatalogue } from '../components/projects/useProjectCatalogue';
import { useProjectSelection } from '../components/projects/useProjectSelection';
import { useShell } from '../store/ShellContext';
import { useProjectContext } from '../store/contexts/ProjectContext';
import { useTaskContext } from '../store/contexts/TaskContext';
import { useProjectRemovalWorkflow } from '../store/workflows/useProjectRemovalWorkflow';
import { toLocalDateStr } from '../services/localDate';
import {
  buildNewProject,
  getProjectPages,
  getProjectWork,
  planProjectEdit,
  type ProjectDraft,
} from '../services/projectModel';
import type { Project } from '../types/domain';

/** Open state for the add/edit project dialog. */
type ProjectEditor = { project: Project | null } | null;

function focusProjectCard(projectId: string): void {
  Array.from(document.querySelectorAll<HTMLElement>('[data-project-open-id]'))
    .find(element => element.dataset.projectOpenId === projectId)
    ?.focus();
}

export default function ProjectsSurface() {
  const shell = useShell();
  const store = useProjectContext();
  const { tasks } = useTaskContext();
  const removeProject = useProjectRemovalWorkflow();
  const catalogue = useProjectCatalogue();
  const selection = useProjectSelection(store.projects);
  const [editor, setEditor] = useState<ProjectEditor>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusProjectId = useRef<string | null>(null);
  const today = toLocalDateStr(new Date());

  const { selectedProjectId, selectedProject, detailProject, managedProjectId } = selection;
  const work = useMemo(() => getProjectWork(tasks, selectedProjectId), [tasks, selectedProjectId]);
  const pages = useMemo(() => getProjectPages(store.projectPages, selectedProjectId), [store.projectPages, selectedProjectId]);

  // Entering the workspace focuses Back; leaving it returns focus to the project's card.
  useEffect(() => {
    if (managedProjectId) {
      backButtonRef.current?.focus();
      return;
    }
    const projectId = returnFocusProjectId.current;
    if (!projectId) return;
    returnFocusProjectId.current = null;
    focusProjectCard(projectId);
  }, [managedProjectId]);

  const handleAssistantNavigation = useEffectEvent((requestId: string, revealProjectId?: string) => {
    if (revealProjectId && store.projects.some(project => project.id === revealProjectId)) {
      selection.reveal(revealProjectId);
      catalogue.clearFilters();
    }
    shell.dismissAssistantNavigationRequest(requestId);
  });

  useEffect(() => {
    const request = shell.assistantNavigationRequest;
    if (!request || request.surface !== 'projects') return;
    handleAssistantNavigation(request.id, request.surfaceState?.projects?.revealProjectId);
  }, [shell.assistantNavigationRequest]);

  const closeEditor = useCallback(() => setEditor(null), []);
  const editedProjectId = editor?.project?.id ?? null;
  // The card that opened the editor may have re-rendered in another section; find it again by id.
  const restoreEditorFocus = useCallback(() => {
    if (editedProjectId) focusProjectCard(editedProjectId);
  }, [editedProjectId]);

  function saveProject(draft: ProjectDraft): void {
    const editing = editor?.project;
    if (editing) {
      const plan = planProjectEdit(editing, draft);
      store.updateProject(editing.id, plan.reference);
      if (plan.archived !== undefined) catalogue.changeArchived(editing, plan.archived, false);
      if (plan.status !== undefined) store.updateProject(editing.id, { status: plan.status });
      if (plan.pinned !== undefined) catalogue.changePinned(editing, plan.pinned, false);
      selection.pickProject(editing.id);
    } else {
      selection.showCreated(store.addProject(buildNewProject(draft)));
    }
    setEditor(null);
  }

  function confirmRemoveProject(project: Project): void {
    if (!window.confirm(`Remove project "${project.name}"? Linked tasks will stay in Sabah One but lose their project assignment.`)) return;
    removeProject(project.id);
    selection.pickProject(null);
  }

  function leaveManagement(): void {
    returnFocusProjectId.current = managedProjectId;
    selection.leaveManagement();
  }

  const openCreateProject = () => setEditor({ project: null });
  const projectCount = store.projects.length;

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Projects</h1>
          <div className="subtitle">
            {projectCount === 0
              ? 'No projects yet'
              : `${projectCount} project${projectCount === 1 ? '' : 's'} in your reference catalogue`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={openCreateProject}>+ Add Project</button>
      </div>

      <div className="surface-body">
        {projectCount === 0 ? (
          <div className="empty-state" role="status">
            <div className="empty-icon">&#128736;</div>
            <h3>Build your project reference catalogue</h3>
            <p>Create a project to keep its live link, repository, setup notes, and management workspace easy to find again.</p>
            <button className="btn btn-primary" onClick={openCreateProject}>+ Create Project</button>
          </div>
        ) : managedProjectId ? (
          <ProjectWorkspace
            catalogue={catalogue}
            project={selectedProject}
            work={work}
            pages={pages}
            today={today}
            activeTab={selection.activeTab}
            onTabChange={selection.setActiveTab}
            pickedPageId={selection.pickedPageId}
            onPickPage={selection.pickPage}
            backButtonRef={backButtonRef}
            onBack={leaveManagement}
            onSelectProject={selection.pickProject}
            onQuickAdd={openCreateProject}
            onEdit={project => setEditor({ project })}
            onRemove={confirmRemoveProject}
          />
        ) : (
          <ProjectCatalogueView catalogue={catalogue} onOpen={project => selection.openDetails(project.id)} />
        )}
      </div>

      {detailProject && !managedProjectId && (
        <ProjectReferenceDrawer
          project={detailProject}
          activeWorkCount={work.all.filter(task => !task.completed).length}
          milestoneCount={work.milestones.length}
          feedback={catalogue.announcement || undefined}
          onClose={selection.closeDetails}
          onEdit={() => {
            selection.closeDetails();
            setEditor({ project: detailProject });
          }}
          onManage={() => selection.manage(detailProject.id)}
          onCopy={(value, label) => { void catalogue.copyReference(value, label); }}
          onPinChange={pinned => catalogue.changePinned(detailProject, pinned, false)}
          onArchiveChange={archived => catalogue.changeArchived(detailProject, archived, false)}
        />
      )}

      {editor && (
        <ProjectEditorDialog
          project={editor.project}
          onSave={saveProject}
          onClose={closeEditor}
          restoreFocusFallback={restoreEditorFocus}
        />
      )}
    </>
  );
}
