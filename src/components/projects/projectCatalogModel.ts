import type { Project, ProjectDeviceBinding } from '../../types/domain';

export type ProjectCatalogFilter = 'all' | 'active' | 'live' | 'local' | 'hardware' | 'reference';

export interface ProjectAvailability {
  key: 'live' | 'local' | 'hybrid' | 'reference';
  label: 'Live' | 'Local only' | 'Live + local' | 'Reference';
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
  binding?: ProjectDeviceBinding,
): ProjectAvailability {
  const hasLiveLink = (project.links || []).some(link => (
    (link.kind === 'deployment' || link.kind === 'demo') && isLiveProjectUrl(link.url)
  ));
  const hasLocalWorkflow = Boolean(binding?.projectRoot) || (project.runRecipes || []).length > 0;
  if (hasLiveLink && hasLocalWorkflow) return { key: 'hybrid', label: 'Live + local' };
  if (hasLiveLink) return { key: 'live', label: 'Live' };
  if (hasLocalWorkflow) return { key: 'local', label: 'Local only' };
  return { key: 'reference', label: 'Reference' };
}
