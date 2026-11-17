import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import AiUpdatesFeed from '../components/dashboard/AiUpdatesFeed';
import NightCompassDashboard from '../components/dashboard/NightCompassDashboard';
import PrayerSyncStatus from '../components/dashboard/PrayerSyncStatus';
import '../components/dashboard/ai-updates.css';
import { useAiUpdates } from '../hooks/useAiUpdates';
import { useSharedPageReady } from '../store/PageReadinessGate';

type HomeTab = 'night-compass' | 'ai-updates';

export default function DashboardSurface() {
  const prayerActionsReady = useSharedPageReady();
  const feed = useAiUpdates();
  const [tab, setTab] = useState<HomeTab>('night-compass');
  const [seenRelease, setSeenRelease] = useState(0);
  const nightCompassTab = useRef<HTMLButtonElement>(null);
  const aiUpdatesTab = useRef<HTMLButtonElement>(null);
  const { latestRelease } = feed;

  function selectTab(next: HomeTab) {
    if (next === 'ai-updates' || tab === 'ai-updates') setSeenRelease(latestRelease);
    setTab(next);
    if (next === 'ai-updates') void feed.refresh();
  }

  function handleTabKeys(event: KeyboardEvent<HTMLDivElement>) {
    const next = {
      ArrowLeft: tab === 'night-compass' ? 'ai-updates' : 'night-compass',
      ArrowRight: tab === 'night-compass' ? 'ai-updates' : 'night-compass',
      Home: 'night-compass',
      End: 'ai-updates',
    }[event.key] as HomeTab | undefined;
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    (next === 'night-compass' ? nightCompassTab : aiUpdatesTab).current?.focus();
  }

  return (
    <>
      <div className="surface-header nc-surface-header home-surface-header">
        <div className="home-tabs" role="tablist" aria-label="Homepage" onKeyDown={handleTabKeys}>
          <button
            type="button"
            id="home-night-compass-tab"
            ref={nightCompassTab}
            role="tab"
            aria-selected={tab === 'night-compass'}
            aria-controls="home-night-compass"
            tabIndex={tab === 'night-compass' ? 0 : -1}
            onClick={() => selectTab('night-compass')}
          >
            Night Compass
          </button>
          <button
            type="button"
            id="home-ai-updates-tab"
            ref={aiUpdatesTab}
            role="tab"
            aria-selected={tab === 'ai-updates'}
            aria-controls="home-ai-updates"
            tabIndex={tab === 'ai-updates' ? 0 : -1}
            onClick={() => selectTab('ai-updates')}
          >
            AI Updates
            {tab === 'night-compass' && latestRelease > seenRelease && <span className="home-tab-new">New</span>}
          </button>
        </div>
        {tab === 'night-compass' ? (
          <div>
            <h1>Night Compass</h1>
            <div className="subtitle">Prayer first · Learn and Move daily · Tasks second-order</div>
          </div>
        ) : <h1 className="ai-updates-sr-only">AI Updates</h1>}
      </div>
      <div
        id="home-night-compass"
        role="tabpanel"
        aria-label="Dashboard content"
        className="surface-body nc-dashboard-body"
        tabIndex={0}
        hidden={tab !== 'night-compass'}
      >
        <PrayerSyncStatus />
        <NightCompassDashboard prayerActionsReady={prayerActionsReady} />
      </div>
      <div
        id="home-ai-updates"
        role="tabpanel"
        aria-labelledby="home-ai-updates-tab"
        className="surface-body ai-updates-body"
        tabIndex={0}
        hidden={tab !== 'ai-updates'}
      >
        <AiUpdatesFeed
          snapshot={feed.snapshot}
          loading={feed.loading}
          offline={feed.offline}
          stale={feed.stale}
          onRetry={() => void feed.refresh(true)}
        />
      </div>
    </>
  );
}
