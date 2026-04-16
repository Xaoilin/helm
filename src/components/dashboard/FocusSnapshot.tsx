import { useMemo, useState } from 'react';
import type { DashboardFocusState, FocusCandidate } from '../../types/domain';

interface FocusSnapshotProps {
  dashboardFocus: DashboardFocusState;
  onOpenCandidate: (candidateId?: string) => void;
  onSnoozeCandidate: (candidateId?: string) => void;
  onShowAnother: () => void;
  onQuickComplete: (candidateId: string) => void;
  onOpenAllTasks: () => void;
}

function getKindLabel(candidate: FocusCandidate): string {
  switch (candidate.kind) {
    case 'habit':
      return 'Routine';
    case 'meeting_prep':
      return 'Meeting prep';
    case 'break':
      return 'Reset';
    case 'clear':
      return 'Clear';
    default:
      return 'Task';
  }
}

function getPrimaryLabel(candidate: FocusCandidate): string {
  switch (candidate.kind) {
    case 'meeting_prep':
      return 'Open calendar';
    case 'break':
      return 'Open tasks';
    case 'clear':
      return 'Browse tasks';
    default:
      return 'Open task';
  }
}

function canQuickComplete(candidate: FocusCandidate): boolean {
  return Boolean(candidate.taskId) && (candidate.kind === 'task' || candidate.kind === 'habit');
}

export default function FocusSnapshot({
  dashboardFocus,
  onOpenCandidate,
  onSnoozeCandidate,
  onShowAnother,
  onQuickComplete,
  onOpenAllTasks,
}: FocusSnapshotProps) {
  const [expandedWhyId, setExpandedWhyId] = useState<string | null>(null);

  const primaryCandidate = useMemo(
    () => dashboardFocus.candidates.find(candidate => candidate.id === dashboardFocus.recommendation?.selectedCandidateId)
      || dashboardFocus.candidates[0]
      || null,
    [dashboardFocus.candidates, dashboardFocus.recommendation],
  );

  const queue = useMemo(
    () => dashboardFocus.queueCandidateIds
      .map(candidateId => dashboardFocus.candidates.find(candidate => candidate.id === candidateId))
      .filter((candidate): candidate is FocusCandidate => Boolean(candidate)),
    [dashboardFocus.candidates, dashboardFocus.queueCandidateIds],
  );

  if (!primaryCandidate) {
    return null;
  }

  const recommendationWhy = dashboardFocus.recommendation?.why || primaryCandidate.localWhy;
  const sourceLabel = dashboardFocus.recommendation?.source === 'openai'
    ? 'GPT-selected'
    : dashboardFocus.recommendation?.fallbackReason
      ? 'Local fallback'
      : 'Local ranking';

  return (
    <section className={`dash-focus ${primaryCandidate.kind}`}>
      <div className="dash-focus-hero">
        <div className="dash-focus-copy">
          <div className="dash-focus-label-row">
            <div className="dash-focus-label">UP NEXT</div>
            <div className={`dash-focus-source ${dashboardFocus.recommendation?.source || 'local'}`}>
              {sourceLabel}
            </div>
          </div>
          <div className="dash-focus-title">{primaryCandidate.title}</div>
          <div className="dash-focus-subtitle">{primaryCandidate.subtitle}</div>
          <p className="dash-focus-why">{recommendationWhy}</p>
          <div className="dash-focus-meta">
            <span className="dash-focus-meta-pill">{getKindLabel(primaryCandidate)}</span>
            {primaryCandidate.estimatedMinutes && (
              <span className="dash-focus-meta-pill">{primaryCandidate.estimatedMinutes} min</span>
            )}
            {dashboardFocus.recommendation && (
              <span className="dash-focus-meta-pill">
                {Math.round(dashboardFocus.recommendation.confidence * 100)}% confident
              </span>
            )}
          </div>
          <div className="dash-focus-actions">
            <button className="btn btn-primary" onClick={() => onOpenCandidate(primaryCandidate.id)}>
              {getPrimaryLabel(primaryCandidate)}
            </button>
            {canQuickComplete(primaryCandidate) && (
              <button className="btn btn-secondary" onClick={() => onQuickComplete(primaryCandidate.id)}>
                Complete now
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => onSnoozeCandidate(primaryCandidate.id)}>
              Not now
            </button>
            <button className="btn btn-secondary" onClick={onShowAnother}>
              Show another
            </button>
          </div>
        </div>

        <div className="dash-focus-stats">
          <div className="dash-focus-stat">
            <div className="dash-focus-stat-label">Overdue</div>
            <div className="dash-focus-stat-value">{dashboardFocus.stats.overdueCount}</div>
          </div>
          <div className="dash-focus-stat">
            <div className="dash-focus-stat-label">Due today</div>
            <div className="dash-focus-stat-value">{dashboardFocus.stats.dueTodayCount}</div>
          </div>
          <div className="dash-focus-stat">
            <div className="dash-focus-stat-label">Routines left</div>
            <div className="dash-focus-stat-value">{dashboardFocus.stats.routinesLeft}</div>
          </div>
        </div>
      </div>

      <div className="dash-focus-queue-card">
        <div className="dash-card-header" style={{ marginBottom: 14 }}>
          <span>Task Snapshot</span>
          <button className="dash-card-link" onClick={onOpenAllTasks}>Open all tasks &rarr;</button>
        </div>

        <div className="dash-focus-queue">
          {queue.map((candidate, index) => {
            const isSelected = candidate.id === primaryCandidate.id;
            const expanded = expandedWhyId === candidate.id;
            const candidateWhy = isSelected ? recommendationWhy : candidate.localWhy;

            return (
              <div key={candidate.id} className={`dash-focus-item ${isSelected ? 'selected' : ''}`}>
                <div className="dash-focus-item-main">
                  <div className="dash-focus-item-topline">
                    <span className={`dash-focus-kind ${candidate.kind}`}>{getKindLabel(candidate)}</span>
                    {candidate.estimatedMinutes && (
                      <span className="dash-focus-duration">{candidate.estimatedMinutes} min</span>
                    )}
                    {index === 0 && <span className="dash-focus-rank">Top pick</span>}
                  </div>
                  <button className="dash-focus-item-button" onClick={() => onOpenCandidate(candidate.id)}>
                    <span className="dash-focus-item-title">{candidate.title}</span>
                    <span className="dash-focus-item-subtitle">{candidate.subtitle}</span>
                  </button>
                  {expanded && (
                    <div className="dash-focus-item-why">{candidateWhy}</div>
                  )}
                </div>
                <div className="dash-focus-item-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => setExpandedWhyId(current => current === candidate.id ? null : candidate.id)}>
                    Why
                  </button>
                  {canQuickComplete(candidate) && (
                    <button className="btn btn-secondary btn-sm" onClick={() => onQuickComplete(candidate.id)}>
                      Complete
                    </button>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={() => onSnoozeCandidate(candidate.id)}>
                    Not now
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
