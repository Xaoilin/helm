import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useSortable } from '@dnd-kit/react/sortable';
import type {
  Project,
  ProjectCatalogueSection,
  ProjectKind,
  ProjectRunRecipe,
} from '../../types/domain';
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
}: {
  project: Project;
}) {
  const availability = getProjectAvailability(project);
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

export type ProjectMoveDirection = 'earlier' | 'later';

function ProjectCardActionMenu({
  project,
  reorderEnabled,
  canMoveEarlier,
  canMoveLater,
  onMove,
  onArchiveChange,
}: {
  project: Project;
  reorderEnabled: boolean;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  onMove: (direction: ProjectMoveDirection) => void;
  onArchiveChange: (archived: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  function closeAndReturnFocus(): void {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndReturnFocus();
      return;
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not([disabled])',
    ) || []);
    if (items.length === 0) return;

    event.preventDefault();
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowUp'
          ? (activeIndex <= 0 ? items.length - 1 : activeIndex - 1)
          : (activeIndex + 1) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <div
      ref={containerRef}
      className="project-card-action-menu"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="project-card-more-button"
        aria-label={`More actions for ${project.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-project-action-id={project.id}
        onClick={() => setOpen(current => !current)}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="project-card-menu-popover"
          role="menu"
          aria-label={`${project.name} actions`}
          onKeyDown={handleMenuKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!reorderEnabled || !canMoveEarlier}
            onClick={() => {
              onMove('earlier');
              closeAndReturnFocus();
            }}
          >
            Move earlier
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!reorderEnabled || !canMoveLater}
            onClick={() => {
              onMove('later');
              closeAndReturnFocus();
            }}
          >
            Move later
          </button>
          {project.status !== 'archived' && (
            <>
              <span className="project-card-menu-divider" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="project-card-menu-danger"
                onClick={() => {
                  onArchiveChange(true);
                  setOpen(false);
                }}
              >
                Archive project
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ProjectCard({
  project,
  activeWorkCount,
  section,
  index,
  sectionSize,
  reorderEnabled,
  onOpen,
  onPinChange,
  onArchiveChange,
  onMove,
}: {
  project: Project;
  activeWorkCount: number;
  section: ProjectCatalogueSection;
  index: number;
  sectionSize: number;
  reorderEnabled: boolean;
  onOpen: (project: Project) => void;
  onPinChange: (pinned: boolean) => void;
  onArchiveChange: (archived: boolean) => void;
  onMove: (direction: ProjectMoveDirection) => void;
}) {
  const {
    ref: sortableRef,
    handleRef,
    isDragging,
    isDropTarget,
  } = useSortable({
    id: project.id,
    index,
    group: section,
    data: {
      projectId: project.id,
      projectName: project.name,
      section,
    },
    disabled: !reorderEnabled,
    transition: { duration: 160, easing: 'cubic-bezier(0.2, 0.75, 0.22, 1)' },
  });
  const liveLink = (project.links || []).find(link => (
    link.kind === 'deployment' && isSafeExternalUrl(link.url)
  ));
  const repositoryLink = (project.links || []).find(link => (
    link.kind === 'repository' && isSafeExternalUrl(link.url)
  ));

  return (
    <article
      ref={element => sortableRef(element)}
      className={`project-catalog-card ${project.status === 'archived' ? 'is-archived' : ''} ${isDragging ? 'is-dragging' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
      role="listitem"
      data-project-card-id={project.id}
    >
      <ProjectPreview project={project} />
      <div className="project-card-utility-row">
        {project.status !== 'archived' && (
          <button
            type="button"
            className={`project-card-pin-toggle ${project.isPinned ? 'is-pinned' : ''}`}
            aria-label={`${project.isPinned ? 'Unpin' : 'Pin'} ${project.name}`}
            aria-pressed={project.isPinned}
            data-project-pin-id={project.id}
            onClick={() => onPinChange(!project.isPinned)}
          >
            <span aria-hidden="true">{project.isPinned ? '★' : '☆'}</span>
            {project.isPinned ? 'Pinned' : 'Pin'}
          </button>
        )}
        <button
          ref={element => handleRef(element)}
          type="button"
          className="project-card-drag-handle"
          aria-label={`Reorder ${project.name}`}
          aria-describedby="project-reorder-instructions"
          disabled={!reorderEnabled}
          title={reorderEnabled ? `Reorder ${project.name}` : 'Clear filters to reorder projects'}
          data-project-drag-id={project.id}
        >
          <span aria-hidden="true">⠿</span>
        </button>
      </div>
      <div className="project-card-content">
        <div className="project-card-heading">
          <div>
            <div className="project-card-title-row">
              <h3>{project.name}</h3>
              {project.isPinned && <span className="project-pin" title="Pinned">Pinned</span>}
            </div>
            <p>{project.summary || 'No summary has been added yet.'}</p>
          </div>
        </div>

        <div className="project-badge-row" aria-label="Project status">
          <StatusBadge project={project} />
          <AvailabilityBadge project={project} />
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
          {project.status === 'archived' && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              data-project-unarchive-id={project.id}
              aria-label={`Unarchive ${project.name}`}
              onClick={() => onArchiveChange(false)}
            >
              Unarchive
            </button>
          )}
          {(project.status !== 'archived' || (reorderEnabled && sectionSize > 1)) && (
            <ProjectCardActionMenu
              project={project}
              reorderEnabled={reorderEnabled}
              canMoveEarlier={index > 0}
              canMoveLater={index < sectionSize - 1}
              onMove={onMove}
              onArchiveChange={onArchiveChange}
            />
          )}
        </div>
      </div>
    </article>
  );
}

export function ProjectReferenceDrawer({
  project,
  activeWorkCount,
  milestoneCount,
  feedback,
  onClose,
  onEdit,
  onManage,
  onCopy,
  onPinChange,
  onArchiveChange,
}: {
  project: Project;
  activeWorkCount: number;
  milestoneCount: number;
  feedback?: string;
  onClose: () => void;
  onEdit: () => void;
  onManage: () => void;
  onCopy: (value: string, label: string) => void;
  onPinChange: (pinned: boolean) => void;
  onArchiveChange: (archived: boolean) => void;
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
  const availability = getProjectAvailability(project);

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
                  <span className="project-section-kicker">Reference</span>
                  <h3>Reference commands</h3>
                </div>
              </div>
              <div className="project-recipes">
                {(project.runRecipes || []).map((recipe: ProjectRunRecipe) => (
                  <div className="project-recipe" key={recipe.id}>
                    <div className="project-recipe-heading">
                      <div>
                        <strong>{recipe.label}</strong>
                        {recipe.prerequisites && recipe.prerequisites.length > 0 && (
                          <p>{recipe.prerequisites.join(' · ')}</p>
                        )}
                      </div>
                      <span className="project-reference-state">Reference only</span>
                    </div>
                    <div className="project-command-row">
                      <code className="project-command-code">{recipe.displayCommand || [recipe.executable, ...recipe.args].join(' ')}</code>
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => onCopy(recipe.displayCommand || [recipe.executable, ...recipe.args].join(' '), `${recipe.label} command`)}>Copy</button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="project-safety-note">Commands are displayed for reference only and are never run by Sabah One.</p>
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
          <div className="project-drawer-footer-actions">
            {project.status !== 'archived' && (
              <button
                className={`btn btn-sm ${project.isPinned ? 'project-drawer-pin-active' : 'btn-secondary'}`}
                type="button"
                aria-pressed={project.isPinned}
                aria-label={`${project.isPinned ? 'Unpin' : 'Pin'} ${project.name}`}
                onClick={() => onPinChange(!project.isPinned)}
              >
                <span aria-hidden="true">{project.isPinned ? '★' : '☆'}</span>
                {project.isPinned ? 'Pinned' : 'Pin'}
              </button>
            )}
            <button
              className={`btn btn-sm ${project.status === 'archived' ? 'btn-secondary' : 'project-archive-button'}`}
              type="button"
              aria-label={`${project.status === 'archived' ? 'Unarchive' : 'Archive'} ${project.name}`}
              onClick={() => onArchiveChange(project.status !== 'archived')}
            >
              {project.status === 'archived' ? 'Unarchive' : 'Archive'}
            </button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={onEdit}>Edit project</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
