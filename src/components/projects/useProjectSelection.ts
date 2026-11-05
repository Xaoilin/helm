import { useViewPreference } from '../../store/ViewPreferencesContext';
import { useCallback, useMemo, useState } from 'react';
import { resolveProjectId, type ProjectTab } from '../../services/projectModel';
import type { Project } from '../../types/domain';

/**
 * Which project the Projects surface is showing, and how.
 *
 * - `detailProjectId` opens the reference drawer over the catalogue.
 * - `managedProjectId` replaces the catalogue with the management workspace.
 * - The selected project is the managed one, else the drawer's, else the last
 *   one picked; ids that no longer name a project resolve to null.
 */
export function useProjectSelection(projects: readonly Project[]) {
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const [managedProjectId, setManagedProjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useViewPreference<ProjectTab>('projects.tab', 'overview');
  const [pickedPageId, setPickedPageId] = useState<string | null>(null);

  const selectedProjectId = useMemo(
    () => resolveProjectId(projects, managedProjectId || detailProjectId || pickedProjectId),
    [projects, managedProjectId, detailProjectId, pickedProjectId],
  );
  const selectedProject = useMemo(
    () => projects.find(project => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const detailProject = useMemo(
    () => projects.find(project => project.id === detailProjectId) || null,
    [projects, detailProjectId],
  );

  const openDetails = useCallback((projectId: string) => {
    setPickedProjectId(projectId);
    setDetailProjectId(projectId);
  }, []);

  const closeDetails = useCallback(() => setDetailProjectId(null), []);

  const manage = useCallback((projectId: string) => {
    setDetailProjectId(null);
    setManagedProjectId(projectId);
    setPickedProjectId(projectId);
  }, []);

  const leaveManagement = useCallback(() => {
    setManagedProjectId(null);
    setPickedProjectId(null);
  }, []);

  /** Show one project's details from the catalogue, as the assistant asks. */
  const reveal = useCallback((projectId: string) => {
    setPickedProjectId(projectId);
    setDetailProjectId(projectId);
    setManagedProjectId(null);
  }, []);

  const showCreated = useCallback((projectId: string) => {
    setPickedProjectId(projectId);
  }, []);

  return {
    selectedProjectId,
    selectedProject,
    detailProject,
    managedProjectId,
    activeTab,
    setActiveTab,
    pickedPageId,
    pickPage: setPickedPageId,
    pickProject: setPickedProjectId,
    openDetails,
    closeDetails,
    manage,
    leaveManagement,
    reveal,
    showCreated,
  };
}
