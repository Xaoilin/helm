import { QUICK_LINKS } from '../../config/quickLinks';

export default function QuickLinks({ variant }: { variant: 'sidebar' | 'mobile' }) {
  const mobile = variant === 'mobile';

  return (
    <section className={`${variant}-quick-links`} aria-label="Quick links">
      <h2 className="quick-links-heading">Quick links</h2>
      <div className={mobile ? 'mobile-more-grid' : undefined}>
        {QUICK_LINKS.map(link => (
          <a
            key={link.id}
            className={`${mobile ? 'mobile-more-item' : 'sidebar-item'} quick-link`}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${link.label} dashboard (opens in a new tab)`}
            title={`${link.description} (opens in a new tab)`}
          >
            <span className={mobile ? 'mobile-more-icon' : 'icon'} aria-hidden="true">{link.icon}</span>
            <span>{link.label}</span>
            <span className="quick-link-external" aria-hidden="true">↗</span>
          </a>
        ))}
      </div>
    </section>
  );
}
