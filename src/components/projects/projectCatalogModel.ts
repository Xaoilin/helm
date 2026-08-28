import type { Project } from '../../types/domain';

export type ProjectCatalogFilter = 'all' | 'active' | 'live' | 'hardware' | 'reference';

export interface ProjectAvailability {
  key: 'live' | 'reference';
  label: 'Live' | 'Reference';
}

function isLiveProjectUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function getProjectAvailability(
  project: Project,
): ProjectAvailability {
  const hasLiveLink = (project.links || []).some(link => (
    (link.kind === 'deployment' || link.kind === 'demo') && isLiveProjectUrl(link.url)
  ));
  if (hasLiveLink) return { key: 'live', label: 'Live' };
  return { key: 'reference', label: 'Reference' };
}
