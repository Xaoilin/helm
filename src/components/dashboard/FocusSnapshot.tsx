import { useMemo, useState } from 'react';
import type { DashboardFocusState, FocusCandidate, Settings } from '../../types/domain';

interface FocusSnapshotProps {
  assistantProvider: Settings['assistantProvider'];
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
    case 'prayer':
      return 'Prayer';
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
    case 'prayer':
      return 'Open prayer';
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
  return Boolean(candidate.taskId)
    && (candidate.kind === 'task' || candidate.kind === 'habit' || candidate.kind === 'prayer')
    && !candidate.reasoningTags.includes('prayer_pair');
}

function getSourceLabel(dashboardFocus: DashboardFocusState, assistantProvider: Settings['assistantProvider']): string {
  if (dashboardFocus.recommendation?.source === 'openai') {
    return 'GPT-reviewed';
  }

  if (assistantProvider === 'ollama') {
    return 'Ollama mode';
  }

  if (dashboardFocus.recommendation?.fallbackReason) {
    return 'GPT unavailable';
  }

  return 'Local ranking';
}

function getFallbackDetail(
  dashboardFocus: DashboardFocusState,
  assistantProvider: Settings['assistantProvider'],
): string | null {
  if (assistantProvider === 'ollama') {
    return 'Dashboard focus is using local prioritisation because assistant mode is set to Ollama. Switch Settings to Hosted or Auto for GPT review.';
  }

  const reason = dashboardFocus.recommendation?.fallbackReason;
  if (!reason) return null;

  if (dashboardFocus.lastError) {
    return dashboardFocus.lastError;
  }

  switch (reason) {
    case 'not_configured':
      return "Hosted AI isn't configured in this build.";
    case 'sign_in_required':
      return 'Sign in to let GPT review and prioritise your tasks.';
    case 'invalid_schema':
      return 'Hosted AI returned an invalid dashboard focus payload.';
    case 'invalid_selection':
      return 'Hosted AI chose a task that no longer matched the grounded candidate list.';
    case 'unavailable':
    case 'hosted_error':
      return "Hosted AI couldn't be reached.";
    default:
      return 'Hosted AI was unavailable for this recommendation.';
  }
}

export default function FocusSnapshot({
  assistantProvider,
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
  const sourceLabel = getSourceLabel(dashboardFocus, assistantProvider);
  const fallbackDetail = getFallbackDetail(dashboardFocus, assistantProvider);

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
          {fallbackDetail && (
            <div className="dash-focus-fallback">
              <strong>{assistantProvider === 'ollama' ? 'GPT review is off right now.' : 'GPT could not review this right now.'}</strong>
              <span>{fallbackDetail}</span>
            </div>
          )}
          <p className="dash-focus-why">{recommendationWhy}</p>
          <div className="dash-focus-meta">
            <span className="dash-focus-meta-pill">{getKindLabel(primaryCandidate)}</span>
            {primaryCandidate.estimatedMinutes !== undefined && (
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
              <div className="dash-focus-stat-label">Prayers left</div>
              <div className="dash-focus-stat-value">{dashboardFocus.stats.prayersLeft}</div>
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
                    {candidate.estimatedMinutes !== undefined && (
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
