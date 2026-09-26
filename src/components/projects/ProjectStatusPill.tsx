import { StatusPill, type StatusTone } from '../common/StatusPill';
import { getProjectStatusLabel } from '../../services/projectModel';
import type { ProjectStatus } from '../../types/domain';

const PROJECT_STATUS_TONES: Record<ProjectStatus, StatusTone> = {
  planning: { background: 'rgba(59, 130, 246, 0.12)', color: '#93c5fd', border: 'rgba(59, 130, 246, 0.4)' },
  active: { background: 'rgba(34, 197, 94, 0.12)', color: '#86efac', border: 'rgba(34, 197, 94, 0.35)' },
  blocked: { background: 'rgba(245, 158, 11, 0.12)', color: '#fcd34d', border: 'rgba(245, 158, 11, 0.35)' },
  completed: { background: 'rgba(168, 85, 247, 0.12)', color: '#d8b4fe', border: 'rgba(168, 85, 247, 0.35)' },
  archived: { background: 'rgba(107, 114, 128, 0.12)', color: '#d1d5db', border: 'rgba(107, 114, 128, 0.35)' },
};

export function ProjectStatusPill({ status }: { status: ProjectStatus }) {
  return <StatusPill label={getProjectStatusLabel(status)} tone={PROJECT_STATUS_TONES[status]} />;
}
