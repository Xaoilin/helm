import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type {
  Project,
  ProjectCatalogueSection,
  ProjectDeviceBinding,
  ProjectPage,
  ProjectRunProfile,
} from '../../types/domain';
import {
  loadDeviceStore,
  loadStore,
  saveDeviceStore,
  saveStore,
} from '../persistence';
import { canonicalizeProjectPath } from '../../services/projectPaths';
import {
  PROJECT_DEVICE_BINDINGS_STORE_KEY,
  PROJECT_PENDING_LEGACY_PATHS_STORE_KEY,
  isAbsoluteProjectRoot,
  migrateLegacyProjectDeviceBindings,
  migrateLegacyWorkspaceRecord,
  normalizePendingLegacyProjectPaths,
  normalizeProjectDeviceBindings,
  normalizeProjectRecord,
  normalizeProjectRecords,
  serializeSharedProjects,
  upsertProjectDeviceRoot,
  upsertProjectRunProfile,
  type LegacyWorkspaceRecord,
  type PendingLegacyProjectPath,
} from '../projectPersistence';
import {
  appendProjectToCollection,
  reorderProjectsInSection,
  setProjectArchivedInCollection,
  setProjectPinnedInCollection,
} from '../projectOrdering';

export interface ProjectContextValue {
  projects: Project[];
  projectDeviceBindings: ProjectDeviceBinding[];
  projectPages: ProjectPage[];
  loaded: boolean;
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateProject: (id: string, updates: Partial<Project>) => void;
  removeProject: (id: string) => void;
  setProjectPinned: (projectId: string, isPinned: boolean) => void;
  setProjectArchived: (projectId: string, isArchived: boolean) => void;
  reorderProjectSection: (section: ProjectCatalogueSection, orderedProjectIds: string[]) => void;
  setProjectDeviceRoot: (catalogKey: string, projectRoot: string) => boolean;
  clearProjectDeviceBinding: (catalogKey: string) => void;
  approveProjectRunProfile: (catalogKey: string, profile: ProjectRunProfile) => void;
  removeProjectRunProfile: (catalogKey: string, profileId: string) => void;
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
  const [projectDeviceBindings, setProjectDeviceBindings] = useState<ProjectDeviceBinding[]>([]);
  const [pendingLegacyProjectPaths, setPendingLegacyProjectPaths] = useState<PendingLegacyProjectPath[]>([]);
  const [projectPages, setProjectPages] = useState<ProjectPage[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const now = new Date().toISOString();
      const [storedProjects, storedPages, storedBindings, storedPendingPaths, storedWorkspaces] = await Promise.all([
        loadStore<unknown>('projects'),
        loadStore<ProjectPage[]>('projectPages'),
        loadDeviceStore<unknown>(PROJECT_DEVICE_BINDINGS_STORE_KEY),
        loadDeviceStore<unknown>(PROJECT_PENDING_LEGACY_PATHS_STORE_KEY),
        loadStore<LegacyWorkspaceRecord[]>('workspaces'),
      ]);
      const sourceRecords = Array.isArray(storedProjects) && storedProjects.length > 0
        ? storedProjects
        : (storedWorkspaces || []).map((workspace, index) => migrateLegacyWorkspaceRecord(workspace, index, now));
      const nextProjects = normalizeProjectRecords(sourceRecords, now);
      const existingBindings = normalizeProjectDeviceBindings(storedBindings, now);
      const existingPendingPaths = normalizePendingLegacyProjectPaths(storedPendingPaths, now);
      const migration = await migrateLegacyProjectDeviceBindings(
        sourceRecords,
        nextProjects,
        existingBindings,
        existingPendingPaths,
        canonicalizeProjectPath,
        now,
      );
      const nextPages = ensureOverviewPages(nextProjects, storedPages || []);

      setProjects(nextProjects);
      setProjectDeviceBindings(migration.bindings);
      setPendingLegacyProjectPaths(migration.pendingPaths);
      setProjectPages(nextPages);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (loaded) {
      void saveStore('projects', serializeSharedProjects(projects));
    }
  }, [projects, loaded]);

  useEffect(() => {
    if (loaded) {
      void saveDeviceStore(PROJECT_DEVICE_BINDINGS_STORE_KEY, projectDeviceBindings);
    }
  }, [projectDeviceBindings, loaded]);

  useEffect(() => {
    if (loaded) {
      void saveDeviceStore(PROJECT_PENDING_LEGACY_PATHS_STORE_KEY, pendingLegacyProjectPaths);
    }
  }, [loaded, pendingLegacyProjectPaths]);

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

    const legacyPath = project.localPath?.trim();
    const catalogKey = nextProject.catalogKey;
    if (legacyPath && catalogKey) {
      setProjectDeviceBindings(prev => upsertProjectDeviceRoot(
        prev,
        catalogKey,
        legacyPath,
        'user',
        now,
      ));
    }
    setProjects(prev => appendProjectToCollection(prev, nextProject, now));
    setProjectPages(prev => [buildOverviewPage(nextProject), ...prev]);
    return id;
  }, []);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    const updatedAt = new Date().toISOString();
    const existing = projects.find(project => project.id === id);
    const existingCatalogKey = existing?.catalogKey;
    if (existingCatalogKey && Object.prototype.hasOwnProperty.call(updates, 'localPath')) {
      const nextPath = updates.localPath?.trim() || '';
      setProjectDeviceBindings(prev => (
        isAbsoluteProjectRoot(nextPath)
          ? upsertProjectDeviceRoot(prev, existingCatalogKey, nextPath, 'user', updatedAt)
          : prev.filter(binding => binding.catalogKey !== existingCatalogKey)
      ));
    }

    setProjects(prev => prev.map(project => (
      project.id === id
        ? normalizeProjectRecord({
          ...project,
          ...updates,
          id,
          catalogKey: project.catalogKey,
          localPath: undefined,
          updatedAt,
        }, project.name)
        : project
    )));
  }, [projects]);

  const removeProject = useCallback((id: string) => {
    const catalogKey = projects.find(project => project.id === id)?.catalogKey;
    if (catalogKey) {
      setProjectDeviceBindings(prev => prev.filter(binding => binding.catalogKey !== catalogKey));
      setPendingLegacyProjectPaths(prev => prev.filter(pending => pending.catalogKey !== catalogKey));
    }
    setProjects(prev => prev.filter(project => project.id !== id));
    setProjectPages(prev => prev.filter(page => page.projectId !== id));
  }, [projects]);

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

  const setProjectDeviceRoot = useCallback((catalogKey: string, projectRoot: string): boolean => {
    if (!catalogKey.trim() || !isAbsoluteProjectRoot(projectRoot)) return false;
    setProjectDeviceBindings(prev => upsertProjectDeviceRoot(prev, catalogKey, projectRoot));
    setPendingLegacyProjectPaths(prev => prev.filter(pending => pending.catalogKey !== catalogKey));
    return true;
  }, []);

  const clearProjectDeviceBinding = useCallback((catalogKey: string) => {
    setProjectDeviceBindings(prev => prev.filter(binding => binding.catalogKey !== catalogKey));
    setPendingLegacyProjectPaths(prev => prev.filter(pending => pending.catalogKey !== catalogKey));
  }, []);

  const approveProjectRunProfile = useCallback((catalogKey: string, profile: ProjectRunProfile) => {
    setProjectDeviceBindings(prev => upsertProjectRunProfile(prev, catalogKey, profile));
  }, []);

  const removeProjectRunProfile = useCallback((catalogKey: string, profileId: string) => {
    setProjectDeviceBindings(prev => prev.map(binding => (
      binding.catalogKey === catalogKey
        ? {
          ...binding,
          updatedAt: new Date().toISOString(),
          runProfiles: binding.runProfiles.filter(profile => profile.profileId !== profileId),
        }
        : binding
    )));
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
      projectDeviceBindings,
      projectPages,
      loaded,
      addProject,
      updateProject,
      removeProject,
      setProjectPinned,
      setProjectArchived,
      reorderProjectSection,
      setProjectDeviceRoot,
      clearProjectDeviceBinding,
      approveProjectRunProfile,
      removeProjectRunProfile,
      addProjectPage,
      updateProjectPage,
      removeProjectPage,
    }}
    >
      {children}
    </ProjectCtx.Provider>
  );
}
