import { useState } from 'react';
import { useProjectContext } from '../../store/contexts/ProjectContext';
import {
  NEW_WIKI_PAGE,
  formatProjectTimestamp,
  searchProjectPages,
} from '../../services/projectModel';
import type { Project, ProjectPage } from '../../types/domain';

/** Searchable wiki page list beside the selected page's editor. */
export function ProjectWikiPanel({
  project,
  pages,
  selectedPageId,
  onSelectPage,
}: {
  project: Project;
  /** The project's pages in display order. */
  pages: ProjectPage[];
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
}) {
  const store = useProjectContext();
  const [search, setSearch] = useState('');
  const results = searchProjectPages(pages, search);
  const selectedPage = pages.find(page => page.id === selectedPageId) || null;

  function createPage(): void {
    const pageId = store.addProjectPage({ projectId: project.id, ...NEW_WIKI_PAGE, isOverview: false });
    onSelectPage(pageId);
  }

  return (
    <div id="project-panel-wiki" className="project-wiki-layout" role="tabpanel" aria-labelledby="project-tab-wiki" tabIndex={0}>
      <div className="card" style={{ padding: 18, display: 'grid', gap: 12, alignContent: 'start' }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Wiki Pages</div>
          <input className="form-input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search wiki" />
        </div>
        <button className="btn btn-secondary btn-sm" onClick={createPage}>+ New Page</button>
        <div style={{ display: 'grid', gap: 8 }}>
          {results.map(page => (
            <button
              key={page.id}
              type="button"
              onClick={() => onSelectPage(page.id)}
              style={{
                textAlign: 'left',
                padding: 12,
                borderRadius: 12,
                border: selectedPageId === page.id ? '1px solid #4f5bff' : '1px solid #23283c',
                background: selectedPageId === page.id ? 'rgba(79, 91, 255, 0.12)' : '#121620',
                color: '#f5f7ff',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{page.title}</div>
                {page.isOverview && <span className="tag tag-connected">Overview</span>}
              </div>
              <div style={{ fontSize: 11, color: '#8b8fa3', marginTop: 6 }}>{formatProjectTimestamp(page.updatedAt)}</div>
            </button>
          ))}
          {results.length === 0 && <div style={{ fontSize: 13, color: '#8b8fa3' }}>No wiki pages match this search.</div>}
        </div>
      </div>

      <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
        {selectedPage ? (
          <ProjectWikiEditor
            key={selectedPage.id}
            page={selectedPage}
            onSave={(title, content) => store.updateProjectPage(selectedPage.id, { title: title.trim() || 'Untitled Page', content })}
            onDelete={() => {
              if (window.confirm(`Delete wiki page "${selectedPage.title}"?`)) store.removeProjectPage(selectedPage.id);
            }}
          />
        ) : (
          <div style={{ fontSize: 13, color: '#8b8fa3' }}>Select a page to edit your project wiki.</div>
        )}
      </div>
    </div>
  );
}

function ProjectWikiEditor({
  page,
  onSave,
  onDelete,
}: {
  page: ProjectPage;
  onSave: (title: string, content: string) => void;
  onDelete: () => void;
}) {
  const [titleDraft, setTitleDraft] = useState(page.title);
  const [contentDraft, setContentDraft] = useState(page.content);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          {page.isOverview ? 'Project Overview Page' : 'Project Wiki Page'}
        </div>
        <div className="actions-row" style={{ margin: 0 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => onSave(titleDraft, contentDraft)}>Save Page</button>
          {!page.isOverview && (
            <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#8b8fa3' }}>
        Last updated {formatProjectTimestamp(page.updatedAt)}. Pages are account-backed markdown-style notes.
      </div>

      <input className="form-input" value={titleDraft} onChange={event => setTitleDraft(event.target.value)} placeholder="Page title" />
      <div className="project-wiki-editor">
        <textarea
          className="form-input"
          value={contentDraft}
          onChange={event => setContentDraft(event.target.value)}
          style={{ minHeight: 320 }}
          placeholder="Write markdown notes, commands, setup steps, and decisions here."
        />
        <div style={{ padding: 16, borderRadius: 14, background: '#121620', border: '1px solid #23283c' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7, color: '#6b6f85', marginBottom: 10 }}>Preview</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', color: '#e5e7eb', lineHeight: 1.6 }}>
            {contentDraft || 'Nothing written yet.'}
          </pre>
        </div>
      </div>
    </>
  );
}
