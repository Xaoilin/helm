import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AnimationAction, AnimationMixer, Object3D } from 'three';
import lifeHeroBaseOnlyStaticUrl from '../../../docs/design/evidence/life-hero-jacket-off.png';
import LifeHeroAdventure from './LifeHeroAdventure';
import { useLifeHeroVoice } from '../../hooks/useLifeHeroVoice';
import { syncLifeHeroEvidence } from '../../store/supabase';
import { useRemoteStoreRefresh } from '../../store/contexts/useRemoteStoreRefresh';
import {
  deriveLifeHeroDashboardView,
  deriveLifeHeroMotivationalLine,
  LIFE_HERO_AVATAR_CONTRACT,
  LIFE_HERO_CONDITION_PRESENTATION,
  LIFE_HERO_STAT_PRESENTATION,
  selectLifeHeroAsset,
  type LifeHeroDashboardView,
  type LifeHeroMotionState,
} from '../../services/lifeHeroPresentation';
import type { LifeHeroSnapshot } from '../../types/domain';

interface LifeHeroCompanionProps {
  localDate: string;
}

type SnapshotState =
  | { status: 'loading'; snapshot: null; error: null }
  | { status: 'ready'; snapshot: LifeHeroSnapshot; error: null }
  | { status: 'error'; snapshot: null; error: string };

type AvatarStatus = 'static' | 'loading' | 'ready' | 'error';

const INITIAL_STATE: SnapshotState = { status: 'loading', snapshot: null, error: null };

export default function LifeHeroCompanion({ localDate }: LifeHeroCompanionProps) {
  const [snapshotState, setSnapshotState] = useState<SnapshotState>(INITIAL_STATE);
  const [collapsed, setCollapsed] = useState(() => (
    typeof window !== 'undefined' && window.innerWidth <= 900
  ));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [motion, setMotion] = useState<LifeHeroMotionState>('idle');
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>('loading');
  const reducedMotion = useReducedMotion();

  const loadSnapshot = useCallback(async () => {
    setSnapshotState(INITIAL_STATE);
    try {
      const { snapshot } = await syncLifeHeroEvidence(localDate);
      setSnapshotState({ status: 'ready', snapshot, error: null });
    } catch {
      setSnapshotState({
        status: 'error',
        snapshot: null,
        error: 'Progress is unavailable right now. Your stored progress is safe.',
      });
    }
  }, [localDate]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useRemoteStoreRefresh([
    'prayerTracking',
    'gamification',
    'tasks',
    'financeAccounts',
    'transactions',
    'financeBudgets',
    'savingsGoals',
  ], loadSnapshot);

  const view = useMemo(() => snapshotState.snapshot
    ? deriveLifeHeroDashboardView(snapshotState.snapshot)
    : null, [snapshotState.snapshot]);

  if (collapsed) {
    return (
      <aside className="life-hero-companion is-collapsed" aria-label="Life Hero companion">
        <button
          type="button"
          className="life-hero-collapsed-button"
          aria-expanded="false"
          aria-controls="life-hero-panel"
          aria-label={view ? `Show Life Hero companion, level ${view.snapshot.overallLevel}` : 'Show Life Hero companion'}
          onClick={() => setCollapsed(false)}
        >
          <span aria-hidden="true">◇</span>
          <span>Life Hero</span>
          <strong>{view ? `Lv ${view.snapshot.overallLevel}` : 'Open'}</strong>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`life-hero-companion${detailsOpen ? ' has-details' : ''}`}
      aria-labelledby="life-hero-title"
      data-avatar-status={avatarStatus}
    >
      <div id="life-hero-panel" className="life-hero-card">
        <header className="life-hero-header">
          <div>
            <span className="life-hero-eyebrow">Your real-world progression</span>
            <h2 id="life-hero-title">Life Hero</h2>
          </div>
          <button
            type="button"
            className="life-hero-icon-button"
            aria-label="Hide Life Hero companion"
            aria-expanded="true"
            aria-controls="life-hero-panel"
            onClick={() => setCollapsed(true)}
          >
            <span aria-hidden="true">⌄</span>
          </button>
        </header>

        <div className="life-hero-stage" data-tier={view?.evolution.tier ?? 1}>
          <div className="life-hero-base" aria-hidden="true"><i /><i /><i /></div>
          <LifeHeroAvatar
            motion={motion}
            reducedMotion={reducedMotion}
            onStatus={setAvatarStatus}
          />
          <div className="life-hero-stage-badges">
            <span>{view?.evolution.name ?? 'Preparing hero'}</span>
            <span>{view?.evolution.baseName ?? 'Training base'}</span>
          </div>
        </div>

        <LifeHeroSummary state={snapshotState} view={view} onRetry={loadSnapshot} />

        {view && <LifeHeroVoicePanel view={view} />}

        {view && snapshotState.status === 'ready' && (
          <LifeHeroAdventure localDate={localDate} snapshot={snapshotState.snapshot} />
        )}

        <button
          type="button"
          className="life-hero-details-toggle"
          aria-expanded={detailsOpen}
          aria-controls="life-hero-details"
          onClick={() => setDetailsOpen(current => !current)}
        >
          <span>{detailsOpen ? 'Hide hero details' : 'Open hero details'}</span>
          <span aria-hidden="true">{detailsOpen ? '−' : '+'}</span>
        </button>

        {detailsOpen && view && (
          <section id="life-hero-details" className="life-hero-details" aria-labelledby="life-hero-details-title">
            <h3 id="life-hero-details-title" className="sr-only">Life Hero details</h3>
            <section aria-labelledby="life-hero-stats-title">
              <div className="life-hero-section-heading">
                <h3 id="life-hero-stats-title">Seven paths</h3>
                <span>No progress loss</span>
              </div>
              <ul className="life-hero-stat-list">
                {view.stats.map(stat => {
                  const presentation = LIFE_HERO_STAT_PRESENTATION[stat.stat];
                  const condition = LIFE_HERO_CONDITION_PRESENTATION[stat.condition];
                  return (
                    <li key={stat.stat} data-condition={stat.condition}>
                      <span className="life-hero-stat-symbol" aria-hidden="true">{presentation.symbol}</span>
                      <span className="life-hero-stat-copy">
                        <strong>{presentation.label}</strong>
                        <small>{condition.label}</small>
                      </span>
                      <span className="life-hero-stat-value">
                        <strong>Lv {stat.level}</strong>
                        <small>{stat.totalXp} XP</small>
                      </span>
                      <span className="sr-only">{condition.detail}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {!reducedMotion && avatarStatus === 'ready' && (
              <section className="life-hero-motion" aria-labelledby="life-hero-motion-title">
                <div className="life-hero-section-heading">
                  <h3 id="life-hero-motion-title">Movement</h3>
                  <span>Visual only</span>
                </div>
                <div role="group" aria-label="Life Hero movement">
                  {([
                    ['idle', 'Stand'],
                    ['celebrate', 'Motivate'],
                    ['focus', 'Focus'],
                    ['train', 'Train'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={motion === value}
                      onClick={() => setMotion(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

function LifeHeroVoicePanel({ view }: { view: LifeHeroDashboardView }) {
  const line = useMemo(() => deriveLifeHeroMotivationalLine(view), [view]);
  const voice = useLifeHeroVoice('en');
  const busy = voice.status === 'loading' || voice.status === 'speaking';
  const disabled = voice.muted || busy || voice.coolingDown;
  const statusText = voice.error
    ?? (voice.status === 'loading'
      ? 'Preparing the motivational voice…'
      : voice.status === 'speaking'
        ? 'Speaking encouragement…'
        : voice.notice
          ?? (voice.coolingDown ? 'Voice is resting briefly to prevent repeated playback.' : 'Ready when you choose to listen.'));

  return (
    <section
      className="life-hero-voice"
      aria-labelledby="life-hero-voice-title"
      aria-busy={busy}
      data-voice-status={voice.status}
      data-line-category={line.category}
    >
      <div className="life-hero-voice-heading">
        <div>
          <h3 id="life-hero-voice-title">Hero voice</h3>
          <span>Optional encouragement</span>
        </div>
        <button
          type="button"
          className="life-hero-mute-button"
          aria-pressed={voice.muted}
          aria-label={voice.muted ? 'Turn Life Hero voice on' : 'Mute Life Hero voice'}
          onClick={voice.toggleMuted}
        >
          <span aria-hidden="true">{voice.muted ? '○' : '◖'}</span>
          {voice.muted ? 'Muted' : 'Voice on'}
        </button>
      </div>
      <p className="life-hero-voice-line">“{line.text}”</p>
      <div className="life-hero-voice-actions">
        <button
          type="button"
          disabled={disabled}
          aria-describedby="life-hero-voice-status"
          onClick={() => void voice.play(line.text)}
        >
          {voice.muted
            ? 'Text only'
            : voice.status === 'loading'
              ? 'Preparing…'
              : voice.status === 'speaking'
                ? 'Speaking…'
                : voice.coolingDown
                  ? 'Ready shortly'
                  : 'Hear encouragement'}
        </button>
        {voice.status === 'speaking' && (
          <button type="button" className="is-secondary" onClick={voice.stop}>Stop</button>
        )}
      </div>
      <div
        id="life-hero-voice-status"
        className={`life-hero-voice-status${voice.error ? ' is-error' : ''}`}
        role={voice.error ? 'alert' : 'status'}
        aria-live={voice.error ? 'assertive' : 'polite'}
      >
        {statusText}
      </div>
    </section>
  );
}

function LifeHeroSummary({
  state,
  view,
  onRetry,
}: {
  state: SnapshotState;
  view: LifeHeroDashboardView | null;
  onRetry: () => Promise<void>;
}) {
  if (state.status === 'loading') {
    return (
      <div className="life-hero-message" role="status" aria-live="polite">
        <strong>Preparing your hero…</strong>
        <span>Loading your private progression.</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="life-hero-message is-error" role="alert">
        <strong>Hero progress unavailable</strong>
        <span>{state.error}</span>
        <button type="button" onClick={() => void onRetry()}>Try again</button>
      </div>
    );
  }
  if (!view) return null;

  return (
    <div className="life-hero-summary">
      <div className="life-hero-level-row">
        <div>
          <span>Overall level</span>
          <strong>{view.snapshot.overallLevel}</strong>
        </div>
        <div>
          <span>Best active momentum</span>
          <strong>{view.momentumDays > 0 ? `${view.momentumDays} days` : 'Ready'}</strong>
          <small>×{view.momentumMultiplier.toFixed(view.momentumMultiplier === 1 ? 1 : 2)}</small>
        </div>
      </div>
      <div
        className="life-hero-level-track"
        role="progressbar"
        aria-label={`Life Hero level ${view.snapshot.overallLevel} progress`}
        aria-valuemin={view.currentLevelXp}
        aria-valuemax={view.nextLevelXp}
        aria-valuenow={view.snapshot.totalXp}
      >
        <span style={{ width: `${view.levelProgress * 100}%` }} />
      </div>
      <p>{view.encouragement}</p>
      {view.empty && <span className="life-hero-first-step">All seven paths are ready for a first step.</span>}
    </div>
  );
}

function LifeHeroAvatar({
  motion,
  reducedMotion,
  onStatus,
}: {
  motion: LifeHeroMotionState;
  reducedMotion: boolean;
  onStatus: (status: AvatarStatus) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mixerRef = useRef<AnimationMixer | null>(null);
  const actionsRef = useRef<Partial<Record<LifeHeroMotionState, AnimationAction>>>({});
  const currentActionRef = useRef<AnimationAction | null>(null);
  const [failed, setFailed] = useState(false);
  const [renderStatus, setRenderStatus] = useState<AvatarStatus>('loading');
  const automatedBrowser = typeof navigator !== 'undefined' && navigator.webdriver;
  const staticMode = reducedMotion || automatedBrowser;
  const reportStatus = useCallback((status: AvatarStatus) => {
    setRenderStatus(status);
    onStatus(status);
  }, [onStatus]);

  useEffect(() => {
    if (staticMode) {
      reportStatus('static');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let animationFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let renderer: import('three').WebGLRenderer | null = null;
    let loadedRoot: Object3D | null = null;
    reportStatus('loading');
    setFailed(false);

    void Promise.all([
      import('three'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
    ]).then(([THREE, { GLTFLoader }]) => {
      if (disposed) return;
      const capability = navigator as Navigator & { deviceMemory?: number };
      const assetTier = selectLifeHeroAsset({
        deviceMemory: capability.deviceMemory,
        hardwareConcurrency: capability.hardwareConcurrency,
      });
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(26, 1, 0.01, 100);
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      scene.add(new THREE.HemisphereLight(0xf7f3e8, 0x142238, 2.4));
      const key = new THREE.DirectionalLight(0xfff2d3, 3.2);
      key.position.set(3, 4, 4);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x50d7aa, 2.2);
      rim.position.set(-4, 2, -3);
      scene.add(rim);

      const renderSize = () => {
        const parent = canvas.parentElement;
        if (!parent || !renderer) return;
        const width = Math.max(1, parent.clientWidth);
        const height = Math.max(1, parent.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resizeObserver = new ResizeObserver(renderSize);
      if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
      renderSize();

      const loadAvatar = async () => {
        const loader = new GLTFLoader();
        const tiers = assetTier === 'primary'
          ? (['primary', 'fallback'] as const)
          : (['fallback'] as const);
        let accepted: Awaited<ReturnType<typeof loader.loadAsync>> | null = null;

        for (const tier of tiers) {
          try {
            const assetUrl = `${import.meta.env.BASE_URL}${LIFE_HERO_AVATAR_CONTRACT.assets[tier].path}`;
            const candidate = await loader.loadAsync(assetUrl);
            if (disposed) return;
            const body = candidate.scene.getObjectByName(LIFE_HERO_AVATAR_CONTRACT.nodes.body);
            const jacket = candidate.scene.getObjectByName(LIFE_HERO_AVATAR_CONTRACT.nodes.trainingJacket);
            const bodyMesh = body as import('three').SkinnedMesh | undefined;
            const expectedJoints = LIFE_HERO_AVATAR_CONTRACT.skeleton.joints;
            const bodyJoints = bodyMesh?.isSkinnedMesh
              ? bodyMesh.skeleton.bones.map(bone => bone.name)
              : [];
            const clipNames = new Set(candidate.animations.map(clip => clip.name));
            if (
              !bodyMesh?.isSkinnedMesh
              || bodyJoints.length !== expectedJoints.length
              || bodyJoints.some((name, index) => name !== expectedJoints[index])
              || !clipNames.has(LIFE_HERO_AVATAR_CONTRACT.clips.idle)
            ) {
              continue;
            }

            // Keep the rejected concept jacket out of the dashboard. Its modular
            // slot remains documented for a better authored garment later.
            if (jacket) jacket.visible = false;
            accepted = candidate;
            break;
          } catch {
            // Try the constrained asset before using the static fallback.
          }
        }

        if (!accepted || disposed || !renderer) {
          if (!disposed) {
            setFailed(true);
            reportStatus('error');
          }
          return;
        }

        loadedRoot = accepted.scene;
        const box = new THREE.Box3().setFromObject(accepted.scene);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        accepted.scene.position.sub(centre);
        accepted.scene.position.y -= size.y * 0.035;
        scene.add(accepted.scene);
        camera.position.set(0, size.y * 0.03, size.y * 2.4);
        camera.lookAt(0, 0, 0);

        const mixer = new THREE.AnimationMixer(accepted.scene);
        mixerRef.current = mixer;
        const idleClip = accepted.animations.find(candidate => (
          candidate.name === LIFE_HERO_AVATAR_CONTRACT.clips.idle
        ))!;
        actionsRef.current = Object.fromEntries(
          Object.entries(LIFE_HERO_AVATAR_CONTRACT.clips).map(([semanticName, exporterName]) => {
            const clip = accepted.animations.find(candidate => candidate.name === exporterName) ?? idleClip;
            return [semanticName, mixer.clipAction(clip)];
          }),
        );
        const idle = actionsRef.current.idle!;
        idle.play();
        currentActionRef.current = idle;
        reportStatus('ready');

        const clock = new THREE.Clock();
        const render = () => {
          if (disposed || !renderer) return;
          mixer.update(Math.min(clock.getDelta(), 0.05));
          renderer.render(scene, camera);
          animationFrame = requestAnimationFrame(render);
        };
        render();
      };

      void loadAvatar();
    }).catch(() => {
      if (disposed) return;
      setFailed(true);
      reportStatus('error');
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      mixerRef.current?.stopAllAction();
      loadedRoot?.traverse(object => {
        const mesh = object as import('three').Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach(material => material?.dispose());
      });
      renderer?.dispose();
      mixerRef.current = null;
      actionsRef.current = {};
      currentActionRef.current = null;
    };
  }, [reportStatus, staticMode]);

  useEffect(() => {
    const nextAction = actionsRef.current[motion] ?? actionsRef.current.idle;
    if (!nextAction || nextAction === currentActionRef.current) return;
    currentActionRef.current?.fadeOut(0.18);
    nextAction.reset().fadeIn(0.18).play();
    currentActionRef.current = nextAction;
  }, [motion]);

  if (staticMode || failed) {
    return (
      <div className="life-hero-static-avatar">
        <img
          src={lifeHeroBaseOnlyStaticUrl}
          alt="Original Life Hero standing in a ready pose"
        />
        {failed && <span role="status">3D view unavailable. Showing the approved static hero.</span>}
        {reducedMotion && <span className="sr-only">Motion is reduced by your device preference.</span>}
      </div>
    );
  }

  return (
    <div className="life-hero-avatar-stack" data-status={renderStatus}>
      <img
        className="life-hero-avatar-placeholder"
        src={lifeHeroBaseOnlyStaticUrl}
        alt=""
        aria-hidden="true"
      />
      <canvas ref={canvasRef} aria-hidden="true" data-motion={motion} data-garment="base-only" />
      <span className="sr-only" role="status">
        {renderStatus === 'ready' ? 'Animated Life Hero ready.' : 'Preparing the animated Life Hero.'}
      </span>
    </div>
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reduced;
}
