import { useCallback, useEffect, useMemo, useState } from 'react';
import { useProjectContext } from '../../store/contexts/ProjectContext';
import {
  DEFAULT_PROJECT_CATALOGUE_FILTERS,
  collectProjectTags,
  filterProjects,
  groupProjects,
  hasActiveCatalogueFilters,
  shouldRevealArchived,
  type ProjectCatalogueFilters,
} from '../../services/projectModel';
import type { Project, ProjectCatalogueSection } from '../../types/domain';

type ProjectControl = 'pin' | 'unarchive';

/** Move focus to a card control after the card re-renders in its new section. */
function focusProjectControl(projectId: string, control: ProjectControl): void {
  requestAnimationFrame(() => {
    const selector = control === 'pin' ? '[data-project-pin-id]' : '[data-project-unarchive-id]';
    const dataKey = control === 'pin' ? 'projectPinId' : 'projectUnarchiveId';
    Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
      .find(button => button.dataset[dataKey] === projectId)
      ?.focus();
  });
}

/**
 * Catalogue view state for the Projects surface: filters, derived groups, the
 * archived disclosure, the screen-reader announcement, and the pin, archive,
 * and reorder actions that keep them consistent.
 */
export function useProjectCatalogue() {
  const store = useProjectContext();
  const { projects, setProjectPinned, setProjectArchived, reorderProjectSection } = store;
  const [filters, setFilters] = useState<ProjectCatalogueFilters>(DEFAULT_PROJECT_CATALOGUE_FILTERS);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const filteredProjects = useMemo(() => filterProjects(projects, filters), [projects, filters]);
  const groupedProjects = useMemo(() => groupProjects(filteredProjects), [filteredProjects]);
  const availableTags = useMemo(() => collectProjectTags(projects), [projects]);
  const isFiltered = hasActiveCatalogueFilters(filters);

  const archivedCount = groupedProjects.archived.length;
  const { query, status } = filters;
  useEffect(() => {
    if (shouldRevealArchived({ query, status }, archivedCount)) setArchivedExpanded(true);
  }, [archivedCount, query, status]);

  const updateFilters = useCallback((changes: Partial<ProjectCatalogueFilters>) => {
    setFilters(current => ({ ...current, ...changes }));
  }, []);

  const clearFilters = useCallback(() => setFilters(DEFAULT_PROJECT_CATALOGUE_FILTERS), []);

  const toggleArchived = useCallback(() => setArchivedExpanded(current => !current), []);

  const changePinned = useCallback((project: Project, pinned: boolean, focusCard = true) => {
    setProjectPinned(project.id, pinned);
    setAnnouncement(`${project.name} ${pinned ? 'pinned' : 'unpinned'}.`);
    if (focusCard) focusProjectControl(project.id, 'pin');
  }, [setProjectPinned]);

  const changeArchived = useCallback((project: Project, archived: boolean, focusCard = true) => {
    setProjectArchived(project.id, archived);
    setAnnouncement(`${project.name} ${archived ? 'archived' : 'restored to Projects'}.`);
    if (archived) {
      // Show the project where it went: the whole catalogue with Archived open.
      setFilters(DEFAULT_PROJECT_CATALOGUE_FILTERS);
      setArchivedExpanded(true);
    } else {
      setFilters(current => (current.status === 'archived' ? { ...current, status: 'all' } : current));
    }
    if (focusCard) focusProjectControl(project.id, archived ? 'unarchive' : 'pin');
  }, [setProjectArchived]);

  const reorder = useCallback((section: ProjectCatalogueSection, orderedIds: string[]) => {
    reorderProjectSection(section, orderedIds);
  }, [reorderProjectSection]);

  const copyReference = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setAnnouncement(`Copied ${label}.`);
    } catch {
      // The failure is announced to the person; the clipboard error carries no extra detail they can act on.
      setAnnouncement(`Unable to copy ${label}.`);
    }
  }, []);

  return {
    filters,
    updateFilters,
    clearFilters,
    isFiltered,
    filteredProjects,
    groupedProjects,
    availableTags,
    archivedExpanded,
    toggleArchived,
    announcement,
    announce: setAnnouncement,
    changePinned,
    changeArchived,
    reorder,
    copyReference,
  };
}

export type ProjectCatalogueState = ReturnType<typeof useProjectCatalogue>;
