import { SOFTWARE_GITHUB_URL, SOFTWARE_REFERENCES } from '../config/software';
import './SoftwareSurface.css';

export default function SoftwareSurface() {
  return <>
    <div className="surface-header">
      <div>
        <h1>Software</h1>
        <div className="subtitle">Custom tools you build and host on GitHub.</div>
      </div>
      <a className="btn btn-secondary" href={SOFTWARE_GITHUB_URL} target="_blank" rel="noopener noreferrer">
        GitHub repositories <span aria-hidden="true">↗</span>
      </a>
    </div>
    <div className="surface-body">
      <div className="software-grid">
        {SOFTWARE_REFERENCES.map(software => (
          <article className="card software-card" key={software.id} aria-labelledby={`software-${software.id}`}>
            <div className="software-card-heading">
              <h2 id={`software-${software.id}`}>{software.name}</h2>
              {!software.repositoryUrl && <span className="tag tag-disconnected">Repository pending</span>}
            </div>
            <p>{software.description}</p>
            <div className="software-links">
              {software.websiteUrl && <a className="btn btn-primary" href={software.websiteUrl} target="_blank" rel="noopener noreferrer">Open {software.name} ↗</a>}
              {software.downloadUrl && <a className="btn btn-secondary" href={software.downloadUrl} target="_blank" rel="noopener noreferrer">Download {software.name} ↗</a>}
              {software.repositoryUrl && <a className="btn btn-secondary" href={software.repositoryUrl} target="_blank" rel="noopener noreferrer">{software.name} on GitHub ↗</a>}
            </div>
          </article>
        ))}
      </div>
    </div>
  </>;
}
