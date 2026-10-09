/** Shared destinations available from the shell on every Sabah One page. */
export const QUICK_LINKS = [
  {
    id: 'grafana',
    label: 'Grafana',
    icon: '\u{1F4C8}',
    description: 'Sabah One services: API and database latency',
    href: 'https://smallolive2165.grafana.net/d/sabah-one-services/sabah-one-services3a-api-and-database-latency?from=now-6h&to=now&timezone=browser&refresh=1m',
  },
] as const;
