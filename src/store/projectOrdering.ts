import type {
  Project,
  ProjectCatalogueSection,
  ProjectStatusBeforeArchive,
} from '../types/domain';

export interface ProjectCollectionMutation {
  projects: Project[];
  valid: boolean;
  changed: boolean;
}

function isPersistedOrder(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0;
}

function compareProjectNames(left: Project, right: Project): number {
  const leftName = left.name.trim().toLowerCase();
  const rightName = right.name.trim().toLowerCase();
  if (leftName < rightName) return -1;
  if (leftName > rightName) return 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function getProjectCatalogueSection(project: Project): ProjectCatalogueSection {
  if (project.status === 'archived') return 'archived';
  return project.isPinned ? 'pinned' : 'projects';
}

export function compareProjectCatalogueOrder(left: Project, right: Project): number {
  const leftHasOrder = isPersistedOrder(left.sortOrder);
  const rightHasOrder = isPersistedOrder(right.sortOrder);

  if (leftHasOrder && rightHasOrder && left.sortOrder !== right.sortOrder) {
    return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
  }
  if (leftHasOrder !== rightHasOrder) return leftHasOrder ? -1 : 1;
  return compareProjectNames(left, right);
}

export function getOrderedProjectsInSection(
  projects: Project[],
  section: ProjectCatalogueSection,
): Project[] {
  return projects
    .filter(project => getProjectCatalogueSection(project) === section)
    .sort(compareProjectCatalogueOrder);
}

function applySectionOrder(
  projects: Project[],
  section: ProjectCatalogueSection,
  orderedProjectIds: string[],
  updatedAt: string,
): Project[] {
  const orderById = new Map(orderedProjectIds.map((id, index) => [id, index]));

  return projects.map(project => {
    if (getProjectCatalogueSection(project) !== section) return project;
    const sortOrder = orderById.get(project.id);
    if (sortOrder === undefined || project.sortOrder === sortOrder) return project;
    return { ...project, sortOrder, updatedAt };
  });
}

function appendProjectToSection(
  projects: Project[],
  projectId: string,
  sourceSection: ProjectCatalogueSection,
  destinationSection: ProjectCatalogueSection,
  updatedAt: string,
): Project[] {
  let nextProjects = projects;

  if (sourceSection !== destinationSection) {
    const sourceIds = getOrderedProjectsInSection(nextProjects, sourceSection)
      .map(project => project.id);
    nextProjects = applySectionOrder(nextProjects, sourceSection, sourceIds, updatedAt);
  }

  const destinationIds = getOrderedProjectsInSection(nextProjects, destinationSection)
    .map(project => project.id)
    .filter(id => id !== projectId);
  destinationIds.push(projectId);
  return applySectionOrder(nextProjects, destinationSection, destinationIds, updatedAt);
}

export function appendProjectToCollection(
  projects: Project[],
  project: Project,
  updatedAt: string,
): Project[] {
  const section = getProjectCatalogueSection(project);
  const existingIds = getOrderedProjectsInSection(projects, section).map(item => item.id);
  const nextProjects = [...projects, { ...project, sortOrder: existingIds.length, updatedAt }];
  return applySectionOrder(nextProjects, section, [...existingIds, project.id], updatedAt);
}

export function setProjectPinnedInCollection(
  projects: Project[],
  projectId: string,
  isPinned: boolean,
  updatedAt: string,
): ProjectCollectionMutation {
  const project = projects.find(item => item.id === projectId);
  if (!project || (project.status === 'archived' && isPinned)) {
    return { projects, valid: false, changed: false };
  }
  if (project.isPinned === isPinned) {
    return { projects, valid: true, changed: false };
  }

  const sourceSection = getProjectCatalogueSection(project);
  const destinationSection: ProjectCatalogueSection = isPinned ? 'pinned' : 'projects';
  const transitioned = projects.map(item => (
    item.id === projectId
      ? { ...item, isPinned, updatedAt }
      : item
  ));
  const nextProjects = appendProjectToSection(
    transitioned,
    projectId,
    sourceSection,
    destinationSection,
    updatedAt,
  );

  return { projects: nextProjects, valid: true, changed: true };
}

export function setProjectArchivedInCollection(
  projects: Project[],
  projectId: string,
  isArchived: boolean,
  updatedAt: string,
): ProjectCollectionMutation {
  const project = projects.find(item => item.id === projectId);
  if (!project) return { projects, valid: false, changed: false };

  const currentlyArchived = project.status === 'archived';
  if (currentlyArchived === isArchived) {
    return { projects, valid: true, changed: false };
  }

  const sourceSection = getProjectCatalogueSection(project);
  const nextProject: Project = isArchived
    ? {
      ...project,
      status: 'archived',
      statusBeforeArchive: project.status as ProjectStatusBeforeArchive,
      isPinned: false,
      updatedAt,
    }
    : {
      ...project,
      status: project.statusBeforeArchive || 'active',
      isPinned: false,
      updatedAt,
    };
  if (!isArchived) delete nextProject.statusBeforeArchive;

  const destinationSection: ProjectCatalogueSection = isArchived ? 'archived' : 'projects';
  const transitioned = projects.map(item => item.id === projectId ? nextProject : item);
  const nextProjects = appendProjectToSection(
    transitioned,
    projectId,
    sourceSection,
    destinationSection,
    updatedAt,
  );

  return { projects: nextProjects, valid: true, changed: true };
}

export function reorderProjectsInSection(
  projects: Project[],
  section: ProjectCatalogueSection,
  orderedProjectIds: string[],
  updatedAt: string,
): ProjectCollectionMutation {
  if (new Set(orderedProjectIds).size !== orderedProjectIds.length) {
    return { projects, valid: false, changed: false };
  }

  const currentIds = getOrderedProjectsInSection(projects, section).map(project => project.id);
  if (
    currentIds.length !== orderedProjectIds.length
    || orderedProjectIds.some(id => !currentIds.includes(id))
  ) {
    return { projects, valid: false, changed: false };
  }

  const changed = currentIds.some((id, index) => orderedProjectIds[index] !== id)
    || currentIds.some((id, index) => projects.find(project => project.id === id)?.sortOrder !== index);
  if (!changed) return { projects, valid: true, changed: false };

  return {
    projects: applySectionOrder(projects, section, orderedProjectIds, updatedAt),
    valid: true,
    changed: true,
  };
}
