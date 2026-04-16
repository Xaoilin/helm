import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type { Project, ProjectPage, ProjectStatus } from '../../types/domain';
import { loadStore, saveStore } from '../persistence';

interface LegacyWorkspace {
  id?: string;
  name?: string;
  path?: string;
  description?: string;
  isPrimary?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectContextValue {
  projects: Project[];
  projectPages: ProjectPage[];
  loaded: boolean;
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateProject: (id: string, updates: Partial<Project>) => void;
  removeProject: (id: string) => void;
  addProjectPage: (page: Omit<ProjectPage, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateProjectPage: (id: string, updates: Partial<ProjectPage>) => void;
  removeProjectPage: (id: string) => void;
}

const ProjectCtx = createContext<ProjectContextValue | null>(null);

const VALID_PROJECT_STATUSES = new Set<ProjectStatus>(['planning', 'active', 'blocked', 'completed', 'archived']);

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags || []).map(tag => tag.trim()).filter(Boolean))];
}

function normalizeProject(project: Project, fallbackName: string): Project {
  const createdAt = typeof project.createdAt === 'string' && project.createdAt ? project.createdAt : new Date().toISOString();
  const updatedAt = typeof project.updatedAt === 'string' && project.updatedAt ? project.updatedAt : createdAt;
  const status = VALID_PROJECT_STATUSES.has(project.status) ? project.status : 'active';

  return {
    id: project.id || uuid(),
    name: project.name?.trim() || fallbackName,
    localPath: project.localPath?.trim() || undefined,
    summary: project.summary?.trim() || '',
    status,
    tags: normalizeTags(project.tags),
    isPinned: project.isPinned === true,
    createdAt,
    updatedAt,
  };
}

function migrateLegacyWorkspace(workspace: LegacyWorkspace, index: number): Project {
  const fallbackName = `Project ${index + 1}`;
  const createdAt = workspace.createdAt || new Date().toISOString();
  const updatedAt = workspace.updatedAt || createdAt;

  return {
    id: workspace.id || uuid(),
    name: workspace.name?.trim() || fallbackName,
    localPath: workspace.path?.trim() || undefined,
    summary: workspace.description?.trim() || '',
    status: 'active',
    tags: [],
    isPinned: workspace.isPrimary === true,
    createdAt,
    updatedAt,
  };
}

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
      const storedProjects = await loadStore<Project[]>('projects');
      const nextProjects = storedProjects && storedProjects.length > 0
        ? storedProjects.map((project, index) => normalizeProject(project, `Project ${index + 1}`))
        : ((await loadStore<LegacyWorkspace[]>('workspaces')) || []).map(migrateLegacyWorkspace);
      const storedPages = await loadStore<ProjectPage[]>('projectPages');
      const nextPages = ensureOverviewPages(nextProjects, storedPages || []);

      setProjects(nextProjects);
      setProjectPages(nextPages);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (loaded) {
      void saveStore('projects', projects);
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
    const nextProject = normalizeProject({
      ...project,
      id,
      createdAt: now,
      updatedAt: now,
    }, 'New Project');

    setProjects(prev => [nextProject, ...prev]);
    setProjectPages(prev => [buildOverviewPage(nextProject), ...prev]);
    return id;
  }, []);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    const updatedAt = new Date().toISOString();
    setProjects(prev => prev.map(project => (
      project.id === id
        ? normalizeProject({
          ...project,
          ...updates,
          id,
          updatedAt,
        }, project.name)
        : project
    )));
  }, []);

  const removeProject = useCallback((id: string) => {
    setProjects(prev => prev.filter(project => project.id !== id));
    setProjectPages(prev => prev.filter(page => page.projectId !== id));
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
      addProjectPage,
      updateProjectPage,
      removeProjectPage,
    }}
    >
      {children}
    </ProjectCtx.Provider>
  );
}
