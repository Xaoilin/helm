/**
 * The project catalogue and wiki, owned by the knowledge service. Each change is shown at once and saved
 * as one write; project writes answer with the whole catalogue (positions are worked out by the
 * service from what it stores), which replaces the local copy. A refused save shows why and reloads.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type {
  Project,
  ProjectCatalogueSection,
  ProjectPage,
} from '../../types/domain';
import {
  createProject,
  deleteProject,
  deleteProjectPage,
  getProjectCatalogue,
  isKnowledgeServiceEnabled,
  reorderProjects,
  saveProjectPage,
  setProjectArchived as setProjectArchivedOnService,
  setProjectPinned as setProjectPinnedOnService,
  setProjectStatus,
  updateProjectReference,
  type NewProjectInput,
  type ProjectReferenceInput,
} from '../../services/backend/knowledgeServiceApi';
import type { ServiceProjectCatalogue } from '../../services/backend/knowledgeContracts';
import { getProjectCatalogueSection } from '../../services/projectModel';
import { useServiceLoad } from './useServiceLoad';

export interface ProjectContextValue {
  projects: Project[];
  projectPages: ProjectPage[];
  loaded: boolean;
  /** Why the catalogue may be out of date; null while it is current. */
  error: string | null;
  reload: () => Promise<void>;
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => string;
  /** Changes what a project shows, or (alone) its status; pinning and archiving have their own operations. */
  updateProject: (id: string, updates: Partial<Project>) => void;
  removeProject: (id: string) => void;
  setProjectPinned: (projectId: string, isPinned: boolean) => void;
  setProjectArchived: (projectId: string, isArchived: boolean) => void;
  reorderProjectSection: (section: ProjectCatalogueSection, orderedProjectIds: string[]) => void;
  addProjectPage: (page: Omit<ProjectPage, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateProjectPage: (id: string, updates: Partial<ProjectPage>) => void;
  removeProjectPage: (id: string) => void;
}

export const ProjectCtx = createContext<ProjectContextValue | null>(null);

const OVERVIEW_TITLE = 'Overview';

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectCtx);
  if (!ctx) throw new Error('useProjectContext must be used within ProjectProvider');
  return ctx;
}

function referenceOf(project: Project): ProjectReferenceInput {
  return {
    name: project.name,
    summary: project.summary,
    kind: project.kind,
    links: project.links,
    setupSteps: project.setupSteps,
    runRecipes: project.runRecipes,
    preview: project.preview,
    verifiedAt: project.verifiedAt,
    tags: project.tags,
  };
}

/** What a new project sends; the service places it and keeps no restore status for it. */
function newProjectInput(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): NewProjectInput {
  return {
    ...referenceOf({ ...project, id: '', createdAt: '', updatedAt: '' }),
    catalogKey: project.catalogKey,
    status: project.status,
    isPinned: project.isPinned,
  };
}

function isStatusOnly(updates: Partial<Project>): updates is Pick<Project, 'status'> {
  const keys = Object.keys(updates);
  return keys.length === 1 && keys[0] === 'status';
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectPages, setProjectPages] = useState<ProjectPage[]>([]);
  const projectsRef = useRef<Project[]>([]);
  const pagesRef = useRef<ProjectPage[]>([]);

  const publishProjects = useCallback((next: Project[]) => {
    projectsRef.current = next;
    setProjects(next);
  }, []);
  const publishPages = useCallback((next: ProjectPage[]) => {
    pagesRef.current = next;
    setProjectPages(next);
  }, []);
  const publishCatalogue = useCallback((catalogue: ServiceProjectCatalogue) => {
    publishProjects(catalogue.projects);
    publishPages(catalogue.pages);
  }, [publishPages, publishProjects]);

  const load = useCallback(async () => publishCatalogue(await getProjectCatalogue()), [publishCatalogue]);
  const { loaded, error, reload, reportFailure } = useServiceLoad('Projects', isKnowledgeServiceEnabled(), load);

  /** Shows a change at once; the service's catalogue replaces it when the write is confirmed. */
  const change = useCallback((id: string, update: (project: Project) => Project,
    write: () => Promise<ServiceProjectCatalogue>) => {
    const updatedAt = new Date().toISOString();
    publishProjects(projectsRef.current.map(project => (project.id === id ? { ...update(project), updatedAt } : project)));
    write().then(publishCatalogue, reportFailure);
  }, [publishCatalogue, publishProjects, reportFailure]);

  const addProject = useCallback((project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const overviewPageId = uuid();
    const now = new Date().toISOString();
    publishProjects([...projectsRef.current, { ...project, id, createdAt: now, updatedAt: now }]);
    publishPages([{
      id: overviewPageId, projectId: id, title: OVERVIEW_TITLE, content: '', isOverview: true, createdAt: now, updatedAt: now,
    }, ...pagesRef.current]);
    createProject(id, overviewPageId, newProjectInput(project)).then(publishCatalogue, reportFailure);
    return id;
  }, [publishCatalogue, publishPages, publishProjects, reportFailure]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    const current = projectsRef.current.find(project => project.id === id);
    if (!current) return;
    if (isStatusOnly(updates)) {
      change(id, project => ({ ...project, status: updates.status }), () => setProjectStatus(id, updates.status));
      return;
    }
    const next = { ...current, ...updates, id, catalogKey: current.catalogKey };
    change(id, () => next, () => updateProjectReference(id, referenceOf(next)));
  }, [change]);

  const removeProject = useCallback((id: string) => {
    publishProjects(projectsRef.current.filter(project => project.id !== id));
    publishPages(pagesRef.current.filter(page => page.projectId !== id));
    deleteProject(id).then(publishCatalogue, reportFailure);
  }, [publishCatalogue, publishPages, publishProjects, reportFailure]);

  const setProjectPinned = useCallback((projectId: string, isPinned: boolean) => {
    const project = projectsRef.current.find(candidate => candidate.id === projectId);
    if (!project || project.isPinned === isPinned || (isPinned && project.status === 'archived')) return;
    change(projectId, current => ({ ...current, isPinned, sortOrder: undefined }),
      () => setProjectPinnedOnService(projectId, isPinned));
  }, [change]);

  const setProjectArchived = useCallback((projectId: string, isArchived: boolean) => {
    const project = projectsRef.current.find(candidate => candidate.id === projectId);
    if (!project || (project.status === 'archived') === isArchived) return;
    change(projectId, current => (isArchived
      ? { ...current, status: 'archived', statusBeforeArchive: current.status === 'archived' ? undefined : current.status,
        isPinned: false, sortOrder: undefined }
      : { ...current, status: current.statusBeforeArchive || 'active', statusBeforeArchive: undefined, sortOrder: undefined }),
    () => setProjectArchivedOnService(projectId, isArchived));
  }, [change]);

  const reorderProjectSection = useCallback((section: ProjectCatalogueSection, orderedProjectIds: string[]) => {
    publishProjects(projectsRef.current.map(project => {
      const position = getProjectCatalogueSection(project) === section ? orderedProjectIds.indexOf(project.id) : -1;
      return position >= 0 ? { ...project, sortOrder: position } : project;
    }));
    reorderProjects(section, orderedProjectIds).then(publishCatalogue, reportFailure);
  }, [publishCatalogue, publishProjects, reportFailure]);

  const confirmPage = useCallback((saved: ProjectPage) => {
    publishPages(pagesRef.current.map(page => {
      if (page.id === saved.id) return saved;
      return saved.isOverview && page.projectId === saved.projectId ? { ...page, isOverview: false } : page;
    }));
  }, [publishPages]);

  const addProjectPage = useCallback((page: Omit<ProjectPage, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    publishPages([{ ...page, id, createdAt: now, updatedAt: now }, ...pagesRef.current]);
    saveProjectPage(id, { projectId: page.projectId, title: page.title, content: page.content, isOverview: page.isOverview })
      .then(confirmPage, reportFailure);
    return id;
  }, [confirmPage, publishPages, reportFailure]);

  const updateProjectPage = useCallback((id: string, updates: Partial<ProjectPage>) => {
    const current = pagesRef.current.find(page => page.id === id);
    if (!current) return;
    const next = { ...current, ...updates, id, projectId: current.projectId, updatedAt: new Date().toISOString() };
    publishPages(pagesRef.current.map(page => (page.id === id ? next : page)));
    saveProjectPage(id, { projectId: next.projectId, title: next.title, content: next.content, isOverview: next.isOverview })
      .then(confirmPage, reportFailure);
  }, [confirmPage, publishPages, reportFailure]);

  const removeProjectPage = useCallback((id: string) => {
    publishPages(pagesRef.current.filter(page => page.id !== id));
    deleteProjectPage(id).catch(reportFailure);
  }, [publishPages, reportFailure]);

  const value = useMemo<ProjectContextValue>(() => ({
    projects, projectPages, loaded, error, reload, addProject, updateProject, removeProject, setProjectPinned,
    setProjectArchived, reorderProjectSection, addProjectPage, updateProjectPage, removeProjectPage,
  }), [projects, projectPages, loaded, error, reload, addProject, updateProject, removeProject, setProjectPinned,
    setProjectArchived, reorderProjectSection, addProjectPage, updateProjectPage, removeProjectPage]);

  return <ProjectCtx.Provider value={value}>{children}</ProjectCtx.Provider>;
}
