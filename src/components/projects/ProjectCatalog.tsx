import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type {
  Project,
  ProjectDeviceBinding,
  ProjectKind,
  ProjectRunRecipe,
} from '../../types/domain';
import type {
  ApprovedProjectProfile,
  ProjectSessionSnapshot,
} from '../../services/projectRuntime';
import { getProjectAvailability } from './projectCatalogModel';

const KIND_LABELS: Record<ProjectKind, string> = {
  web_app: 'Web app',
  desktop_app: 'Desktop app',
  mobile_app: 'Mobile app',
  cli: 'CLI',
  service: 'Service',
  library: 'Library',
  automation: 'Automation',
  hardware: 'Hardware',
  research: 'Research',
  other: 'Project',
};

function initials(name: string): string {
  return name
    .split(/[\s/]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'PR';
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function StatusBadge({ project }: { project: Project }) {
  return <span className={`project-badge status-${project.status}`}>{project.status}</span>;
}

function AvailabilityBadge({
  project,
  binding,
}: {
  project: Project;
  binding?: ProjectDeviceBinding;
}) {
  const availability = getProjectAvailability(project, binding);
  return <span className={`project-badge availability-${availability.key}`}>{availability.label}</span>;
}

function ProjectPreview({ project }: { project: Project }) {
  const accent = project.preview?.accentColor || '#777dff';
  const background = project.preview?.backgroundColor || '#171b2e';
  const coverImageUrl = project.preview?.coverImageUrl;
  const [failedCoverImageUrl, setFailedCoverImageUrl] = useState<string | undefined>();

  return (
    <div
      className="project-card-preview"
      style={{
        '--project-accent': accent,
        '--project-preview-background': background,
      } as CSSProperties}
      aria-hidden="true"
    >
      {coverImageUrl && failedCoverImageUrl !== coverImageUrl && (
        <img
          className="project-card-cover"
          src={coverImageUrl}
          alt=""
          loading="lazy"
          onError={() => setFailedCoverImageUrl(coverImageUrl)}
        />
      )}
      <span className="project-card-orbit" />
      <span className="project-card-monogram">{project.preview?.icon || initials(project.name)}</span>
      <span className="project-card-kind">{KIND_LABELS[project.kind || 'other']}</span>
    </div>
  );
}

export function ProjectCard({
  project,
  binding,
  activeWorkCount,
  onOpen,
}: {
  project: Project;
  binding?: ProjectDeviceBinding;
  activeWorkCount: number;
  onOpen: (project: Project) => void;
}) {
  const liveLink = (project.links || []).find(link => (
    link.kind === 'deployment' && isSafeExternalUrl(link.url)
  ));
  const repositoryLink = (project.links || []).find(link => (
    link.kind === 'repository' && isSafeExternalUrl(link.url)
  ));

  return (
    <article className="project-catalog-card">
      <ProjectPreview project={project} />
      <div className="project-card-content">
        <div className="project-card-heading">
          <div>
            <div className="project-card-title-row">
              <h2>{project.name}</h2>
              {project.isPinned && <span className="project-pin" title="Pinned">Pinned</span>}
            </div>
            <p>{project.summary || 'No summary has been added yet.'}</p>
          </div>
        </div>

        <div className="project-badge-row" aria-label="Project status">
          <StatusBadge project={project} />
          <AvailabilityBadge project={project} binding={binding} />
          <span className="project-badge kind">{KIND_LABELS[project.kind || 'other']}</span>
        </div>

        <div className="project-card-meta">
          <span>{activeWorkCount} active item{activeWorkCount === 1 ? '' : 's'}</span>
          {project.verifiedAt && (
            <span>Verified {new Date(project.verifiedAt).toLocaleDateString([], { month: 'short', year: 'numeric' })}</span>
          )}
        </div>

        <div className="project-card-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-project-open-id={project.id}
            onClick={() => onOpen(project)}
          >
            View details
          </button>
          {liveLink && (
            <a className="btn btn-secondary btn-sm" href={liveLink.url} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} live site`}>
              Open live
            </a>
          )}
          {repositoryLink && (
            <a className="project-card-text-link" href={repositoryLink.url} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} repository`}>
              Repository
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export interface ProjectRecipeViewState {
  fingerprint?: string;
  profile?: ApprovedProjectProfile;
  session?: ProjectSessionSnapshot;
  pending?: boolean;
  stale?: boolean;
}

export function ProjectReferenceDrawer({
  project,
  binding,
  activeWorkCount,
  milestoneCount,
  desktopPathActions,
  runtimeAvailable,
  recipeStates,
  feedback,
  onClose,
  onEdit,
  onManage,
  onLinkFolder,
  onOpenFolder,
  onCopy,
  onRun,
  onStop,
}: {
  project: Project;
  binding?: ProjectDeviceBinding;
  activeWorkCount: number;
  milestoneCount: number;
  desktopPathActions: boolean;
  runtimeAvailable: boolean;
  recipeStates: Record<string, ProjectRecipeViewState>;
  feedback?: string;
  onClose: () => void;
  onEdit: () => void;
  onManage: () => void;
  onLinkFolder: () => void;
  onOpenFolder: () => void;
  onCopy: (value: string, label: string) => void;
  onRun: (recipe: ProjectRunRecipe) => void;
  onStop: (recipe: ProjectRunRecipe) => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(element => !element.hasAttribute('hidden'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const safeLinks = useMemo(
    () => (project.links || []).filter(link => isSafeExternalUrl(link.url)),
    [project.links],
  );
  const availability = getProjectAvailability(project, binding);
  const sessions = Object.values(recipeStates)
    .map(state => state.session)
    .filter((session): session is ProjectSessionSnapshot => Boolean(session))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const latestSession = sessions[0];

  return (
    <div className="project-drawer-backdrop" onMouseDown={onClose}>
      <section
        ref={drawerRef}
        className="project-reference-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-drawer-title"
        aria-describedby="project-drawer-summary"
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="project-drawer-header">
          <div>
            <span className="project-drawer-eyebrow">{KIND_LABELS[project.kind || 'other']}</span>
            <h2 id="project-drawer-title">{project.name}</h2>
          </div>
          <button ref={closeButtonRef} className="project-drawer-close" type="button" onClick={onClose} aria-label={`Close ${project.name} details`}>
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="project-drawer-scroll">
          <div
            className="project-drawer-hero"
            style={{ '--project-accent': project.preview?.accentColor || '#777dff' } as CSSProperties}
          >
            <div className="project-drawer-hero-mark" aria-hidden="true">{project.preview?.icon || initials(project.name)}</div>
            <div>
              <div className="project-badge-row">
                <StatusBadge project={project} />
                <span className={`project-badge availability-${availability.key}`}>{availability.label}</span>
              </div>
              <p id="project-drawer-summary">{project.summary || 'No project summary has been added yet.'}</p>
            </div>
          </div>

          {project.tags.length > 0 && (
            <div className="project-tag-list" aria-label="Project tags">
              {project.tags.map(tag => <span className="project-tag" key={tag}>{tag}</span>)}
            </div>
          )}

          <section className="project-drawer-section">
            <div className="project-section-heading">
              <div>
                <span className="project-section-kicker">Access</span>
                <h3>Open the project</h3>
              </div>
            </div>
            <div className="project-link-grid">
              {safeLinks.map(link => (
                <a key={link.id} className="project-access-link" href={link.url} target="_blank" rel="noreferrer">
                  <span>{link.label}</span>
                  <small>{link.kind}</small>
                </a>
              ))}
              {safeLinks.length === 0 && (
                <p className="project-muted-copy">No web or repository links have been recorded.</p>
              )}
            </div>
          </section>

          <section className="project-drawer-section">
            <div className="project-section-heading">
              <div>
                <span className="project-section-kicker">This device</span>
                <h3>Local folder</h3>
              </div>
              {desktopPathActions && (
                <button className="btn btn-secondary btn-sm" type="button" onClick={onLinkFolder}>
                  {binding?.projectRoot ? 'Change folder' : 'Link folder'}
                </button>
              )}
            </div>
            {binding?.projectRoot ? (
              <>
                <code className="project-command-code">{binding.projectRoot}</code>
                <div className="project-inline-actions">
                  <button className="btn btn-secondary btn-sm" type="button" onClick={onOpenFolder}>Open folder</button>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => onCopy(binding.projectRoot, 'folder path')}>Copy path</button>
                </div>
              </>
            ) : (
              <p className="project-muted-copy">
                {desktopPathActions
                  ? 'Not linked on this device. Link the existing checkout when you want local actions.'
                  : 'Local folders and one-click commands are available in the HELM desktop app. This web view remains a reference.'}
              </p>
            )}
          </section>

          {(project.setupSteps || []).length > 0 && (
            <section className="project-drawer-section">
              <div className="project-section-heading">
                <div>
                  <span className="project-section-kicker">Reference</span>
                  <h3>Setup and prerequisites</h3>
                </div>
              </div>
              <div className="project-steps">
                {(project.setupSteps || []).map((step, index) => (
                  <div className="project-step" key={step.id}>
                    <span className="project-step-number">{index + 1}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.description}</p>
                      {step.displayCode && (
                        <div className="project-command-row">
                          <code className="project-command-code">{step.displayCode}</code>
                          <button className="btn btn-secondary btn-sm" type="button" onClick={() => onCopy(step.displayCode!, `${step.title} command`)}>Copy</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="project-safety-note">Setup commands are reference-only and are never run automatically.</p>
            </section>
          )}

          {(project.runRecipes || []).length > 0 && (
            <section className="project-drawer-section">
              <div className="project-section-heading">
                <div>
                  <span className="project-section-kicker">Local launch</span>
                  <h3>How to run</h3>
                </div>
              </div>
              <div className="project-recipes">
                {(project.runRecipes || []).map(recipe => {
                  const state = recipeStates[recipe.id] || {};
                  const isRunning = state.session?.status === 'running';
                  const canRun = runtimeAvailable && Boolean(binding?.projectRoot);
                  return (
                    <div className="project-recipe" key={recipe.id}>
                      <div className="project-recipe-heading">
                        <div>
                          <strong>{recipe.label}</strong>
                          {recipe.prerequisites && recipe.prerequisites.length > 0 && (
                            <p>{recipe.prerequisites.join(' · ')}</p>
                          )}
                        </div>
                        <span className={`project-runtime-state ${isRunning ? 'running' : state.stale ? 'stale' : state.profile ? 'trusted' : 'idle'}`}>
                          {isRunning ? 'Running' : state.stale ? 'Review again' : state.profile ? 'Trusted here' : 'Trust required'}
                        </span>
                      </div>
                      <div className="project-command-row">
                        <code className="project-command-code">{recipe.displayCommand || [recipe.executable, ...recipe.args].join(' ')}</code>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => onCopy(recipe.displayCommand || [recipe.executable, ...recipe.args].join(' '), `${recipe.label} command`)}>Copy</button>
                      </div>
                      <div className="project-inline-actions">
                        {isRunning ? (
                          <button className="btn btn-danger btn-sm" type="button" disabled={state.pending} onClick={() => onStop(recipe)}>Stop</button>
                        ) : (
                          <button className="btn btn-primary btn-sm" type="button" disabled={!canRun || state.pending} onClick={() => onRun(recipe)}>
                            {state.pending ? 'Starting…' : canRun ? 'Run' : runtimeAvailable ? 'Link folder to run' : 'Desktop only'}
                          </button>
                        )}
                        {isRunning && recipe.localUrl && (
                          <a className="btn btn-secondary btn-sm" href={recipe.localUrl} target="_blank" rel="noreferrer">Open local app</a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="project-safety-note">The first run shows the exact command and folder for approval. Any change requires approval again.</p>
            </section>
          )}

          {latestSession && (
            <section className="project-drawer-section">
              <div className="project-section-heading">
                <div>
                  <span className="project-section-kicker">Runtime</span>
                  <h3>Latest output</h3>
                </div>
                <span className={`project-runtime-state ${latestSession.status}`}>{latestSession.status}</span>
              </div>
              <div className="project-runtime-log" aria-live="polite" aria-label="Latest project command output">
                {latestSession.logs.length > 0
                  ? latestSession.logs.map((log, index) => (
                    <div className={`project-log-line ${log.stream}`} key={`${log.timestamp}-${index}`}>
                      <span>{log.stream}</span>
                      <code>{log.line}</code>
                    </div>
                  ))
                  : <span className="project-muted-copy">Waiting for output…</span>}
              </div>
            </section>
          )}

          <section className="project-drawer-section project-workspace-summary">
            <div>
              <span className="project-section-kicker">Workspace</span>
              <h3>Plan and document the work</h3>
              <p>{activeWorkCount} active items · {milestoneCount} milestones · Board, milestones, and Wiki stay together.</p>
            </div>
            <button className="btn btn-secondary" type="button" onClick={onManage}>Manage project</button>
          </section>
        </div>

        <footer className="project-drawer-footer">
          <span aria-live="polite">{feedback}</span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={onEdit}>Edit project</button>
        </footer>
      </section>
    </div>
  );
}
