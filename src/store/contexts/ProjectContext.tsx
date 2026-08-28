import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type {
  Project,
  ProjectCatalogueSection,
  ProjectPage,
} from '../../types/domain';
import {
  loadStore,
  saveStore,
} from '../persistence';
import {
  migrateLegacyWorkspaceRecord,
  normalizeProjectRecord,
  normalizeProjectRecords,
  serializeSharedProjects,
  type LegacyWorkspaceRecord,
} from '../projectPersistence';
import {
  appendProjectToCollection,
  reorderProjectsInSection,
  setProjectArchivedInCollection,
  setProjectPinnedInCollection,
} from '../projectOrdering';
import { useRemoteStoreRefresh } from './useRemoteStoreRefresh';

export interface ProjectContextValue {
  projects: Project[];
  projectPages: ProjectPage[];
  loaded: boolean;
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateProject: (id: string, updates: Partial<Project>) => void;
  removeProject: (id: string) => void;
  setProjectPinned: (projectId: string, isPinned: boolean) => void;
  setProjectArchived: (projectId: string, isArchived: boolean) => void;
  reorderProjectSection: (section: ProjectCatalogueSection, orderedProjectIds: string[]) => void;
  addProjectPage: (page: Omit<ProjectPage, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateProjectPage: (id: string, updates: Partial<ProjectPage>) => void;
  removeProjectPage: (id: string) => void;
}

const ProjectCtx = createContext<ProjectContextValue | null>(null);

function buildOverviewContent(project: Project): string {
  const intro = project.summary
    ? `${project.summary}\n\n`
    : '';

  return `# ${project.name}

${intro}## Goals

- Add milestones for this project.

## Notes

- Keep architecture decisions and links here.

## Next Steps

- Capture the next 1-3 actions on the board.`;
}

function buildOverviewPage(project: Project): ProjectPage {
  return {
    id: uuid(),
    projectId: project.id,
    title: 'Overview',
    content: buildOverviewContent(project),
    isOverview: true,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function normalizeProjectPage(page: ProjectPage): ProjectPage {
  const createdAt = typeof page.createdAt === 'string' && page.createdAt ? page.createdAt : new Date().toISOString();
  const updatedAt = typeof page.updatedAt === 'string' && page.updatedAt ? page.updatedAt : createdAt;

  return {
    id: page.id || uuid(),
    projectId: page.projectId,
    title: page.title?.trim() || 'Untitled Page',
    content: page.content || '',
    isOverview: page.isOverview === true,
    createdAt,
    updatedAt,
  };
}

function ensureOverviewPages(projects: Project[], pages: ProjectPage[]): ProjectPage[] {
  const normalizedPages = pages.map(normalizeProjectPage);
  const nextPages = [...normalizedPages];

  for (const project of projects) {
    if (!nextPages.some(page => page.projectId === project.id && page.isOverview)) {
      nextPages.unshift(buildOverviewPage(project));
    }
  }

  return nextPages.filter(page => projects.some(project => project.id === page.projectId));
}

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectCtx);
  if (!ctx) throw new Error('useProjectContext must be used within ProjectProvider');
  return ctx;
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectPages, setProjectPages] = useState<ProjectPage[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const now = new Date().toISOString();
      const [storedProjects, storedPages, storedWorkspaces] = await Promise.all([
        loadStore<unknown>('projects'),
        loadStore<ProjectPage[]>('projectPages'),
        loadStore<LegacyWorkspaceRecord[]>('workspaces'),
      ]);
      const sourceRecords = Array.isArray(storedProjects) && storedProjects.length > 0
        ? storedProjects
        : (storedWorkspaces || []).map((workspace, index) => migrateLegacyWorkspaceRecord(workspace, index, now));
      const nextProjects = normalizeProjectRecords(sourceRecords, now);
      const nextPages = ensureOverviewPages(nextProjects, storedPages || []);

      setProjects(nextProjects);
      setProjectPages(nextPages);
      setLoaded(true);
    })();
  }, []);

  useRemoteStoreRefresh(['projects', 'projectPages', 'workspaces'], async () => {
    const now = new Date().toISOString();
    const [storedProjects, storedPages, storedWorkspaces] = await Promise.all([
      loadStore<unknown>('projects'),
      loadStore<ProjectPage[]>('projectPages'),
      loadStore<LegacyWorkspaceRecord[]>('workspaces'),
    ]);
    const sourceRecords = Array.isArray(storedProjects) && storedProjects.length > 0
      ? storedProjects
      : (storedWorkspaces || []).map((workspace, index) => migrateLegacyWorkspaceRecord(workspace, index, now));
    const nextProjects = normalizeProjectRecords(sourceRecords, now);
    setProjects(nextProjects);
    setProjectPages(ensureOverviewPages(nextProjects, storedPages || []));
  });

  useEffect(() => {
    if (loaded) {
      void saveStore('projects', serializeSharedProjects(projects));
    }
  }, [projects, loaded]);

  useEffect(() => {
    if (loaded) {
      void saveStore('projectPages', projectPages);
    }
  }, [projectPages, loaded]);

  const addProject = useCallback((project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    const nextProject = normalizeProjectRecord({
      ...project,
      id,
      createdAt: now,
      updatedAt: now,
    }, 'New Project');

    setProjects(prev => appendProjectToCollection(prev, nextProject, now));
    setProjectPages(prev => [buildOverviewPage(nextProject), ...prev]);
    return id;
  }, []);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    const updatedAt = new Date().toISOString();
    setProjects(prev => prev.map(project => (
      project.id === id
        ? normalizeProjectRecord({
          ...project,
          ...updates,
          id,
          catalogKey: project.catalogKey,
          updatedAt,
        }, project.name)
        : project
    )));
  }, []);

  const removeProject = useCallback((id: string) => {
    setProjects(prev => prev.filter(project => project.id !== id));
    setProjectPages(prev => prev.filter(page => page.projectId !== id));
  }, []);

  const setProjectPinned = useCallback((projectId: string, isPinned: boolean) => {
    const updatedAt = new Date().toISOString();
    setProjects(prev => setProjectPinnedInCollection(prev, projectId, isPinned, updatedAt).projects);
  }, []);

  const setProjectArchived = useCallback((projectId: string, isArchived: boolean) => {
    const updatedAt = new Date().toISOString();
    setProjects(prev => setProjectArchivedInCollection(prev, projectId, isArchived, updatedAt).projects);
  }, []);

  const reorderProjectSection = useCallback((
    section: ProjectCatalogueSection,
    orderedProjectIds: string[],
  ) => {
    const updatedAt = new Date().toISOString();
    setProjects(prev => reorderProjectsInSection(prev, section, orderedProjectIds, updatedAt).projects);
  }, []);

  const addProjectPage = useCallback((page: Omit<ProjectPage, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    const nextPage = normalizeProjectPage({
      ...page,
      id,
      createdAt: now,
      updatedAt: now,
    });

    setProjectPages(prev => [
      nextPage,
      ...prev.map(existing => (
        existing.projectId === nextPage.projectId && nextPage.isOverview
          ? { ...existing, isOverview: false }
          : existing
      )),
    ]);
    return id;
  }, []);

  const updateProjectPage = useCallback((id: string, updates: Partial<ProjectPage>) => {
    const updatedAt = new Date().toISOString();
    setProjectPages(prev => prev.map(page => (
      page.id === id
        ? normalizeProjectPage({
          ...page,
          ...updates,
          id,
          updatedAt,
        })
        : page
    )));
  }, []);

  const removeProjectPage = useCallback((id: string) => {
    setProjectPages(prev => prev.filter(page => page.id !== id));
  }, []);

  return (
    <ProjectCtx.Provider value={{
      projects,
      projectPages,
      loaded,
      addProject,
      updateProject,
      removeProject,
      setProjectPinned,
      setProjectArchived,
      reorderProjectSection,
      addProjectPage,
      updateProjectPage,
      removeProjectPage,
    }}
    >
      {children}
    </ProjectCtx.Provider>
  );
}
