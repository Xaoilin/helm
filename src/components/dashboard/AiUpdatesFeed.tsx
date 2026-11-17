import { useState } from 'react';
import type { AiUpdateCategory, AiUpdateLink, AiUpdateStory, AiUpdatesSnapshot } from '../../types/domain';

const categories = [
  { id: 'all', label: 'All' },
  { id: 'coding', label: 'Coding tools' },
  { id: 'models', label: 'Models' },
  { id: 'research', label: 'Research' },
] as const;
const categoryLabels: Record<AiUpdateCategory, string> = {
  coding: 'Coding tools',
  models: 'Models',
  research: 'Research',
};
const editionFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const publicationFormat = new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric' });
const STORY_LIMIT = 10;

function StoryLink({ link }: { link: AiUpdateLink }) {
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer">
      {link.label} <span aria-hidden="true">↗</span><span className="ai-updates-sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function StoryCard({ story }: { story: AiUpdateStory }) {
  return (
    <article className={story.featured ? 'ai-update-story ai-update-story-featured' : 'ai-update-story'}>
      <div className="ai-update-meta">
        <span>{categoryLabels[story.category]}</span>
        <time dateTime={story.publishedAt}>{publicationFormat.format(new Date(story.publishedAt))}</time>
      </div>
      <h2>{story.title}</h2>
      <p>{story.summary}</p>
      <div className="ai-update-links">
        <StoryLink link={story.source} />
        {story.discussions.map(link => <StoryLink key={link.url} link={link} />)}
      </div>
    </article>
  );
}

interface AiUpdatesFeedProps {
  snapshot: AiUpdatesSnapshot | null;
  loading: boolean;
  offline: boolean;
  stale: boolean;
  onRetry: () => void;
}

export default function AiUpdatesFeed({ snapshot, loading, offline, stale, onRetry }: AiUpdatesFeedProps) {
  const [filter, setFilter] = useState<(typeof categories)[number]['id']>('all');
  const stories = snapshot?.stories
    .filter(story => filter === 'all' || story.category === filter)
    .slice(0, STORY_LIMIT);

  return (
    <div className="ai-updates-feed">
      <div className="ai-updates-toolbar">
        <div className="ai-updates-filters" role="group" aria-label="Filter AI updates">
          {categories.map(category => (
            <button
              type="button"
              key={category.id}
              aria-pressed={filter === category.id}
              onClick={() => setFilter(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>
        {snapshot && (
          <span className="ai-updates-edition">
            Updated <time dateTime={snapshot.updatedAt}>{editionFormat.format(new Date(snapshot.updatedAt))}</time>
          </span>
        )}
      </div>
      {loading && !snapshot && <p className="ai-updates-status" role="status">Loading AI updates…</p>}
      {(offline || stale) && (
        <div className="ai-updates-status">
          <span role="status">
            {offline
              ? snapshot ? 'Live refresh unavailable. Showing the saved edition.' : 'AI updates could not be loaded.'
              : 'The latest edition is delayed.'}
          </span>
          {!loading && <button type="button" onClick={onRetry}>Retry</button>}
        </div>
      )}
      {stories?.length === 0 && <p className="ai-updates-status" role="status">No recent updates in this view.</p>}
      {stories && stories.length > 0 && (
        <div className="ai-updates-stories">
          {stories.map(story => <StoryCard key={story.id} story={story} />)}
        </div>
      )}
    </div>
  );
}
