import { APP_VERSION } from '../config/release';
import { logError, logInfo, logWarn } from './logger';

const RELEASE_REFRESH_SOURCE = 'ReleaseRefresh';
const RELEASE_MANIFEST_NAME = 'release.json';
const RELEASE_REFRESH_SESSION_KEY_PREFIX = 'helm:release-refresh:';

export type ReleaseManifest = {
  version: string;
};

type ReleaseFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'json' | 'ok' | 'status'>>;

type ReleaseSessionStore = Pick<Storage, 'getItem' | 'setItem'>;

export type CheckForPublishedReleaseOptions = {
  basePath?: string;
  currentVersion?: string;
  fetcher?: ReleaseFetcher;
  now?: () => number;
  origin?: string;
  protocol?: string;
  reload?: () => void;
  sessionStore?: ReleaseSessionStore;
};

export function parseSemver(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)$/u);
  if (!match) {
    return null;
  }

  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
}

export function compareSemverVersions(left: string, right: string): number | null {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);

  if (!leftParts || !rightParts) {
    return null;
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }

  return 0;
}

export function shouldForceRefreshForRelease(currentVersion: string, publishedVersion: string): boolean {
  const comparison = compareSemverVersions(currentVersion, publishedVersion);
  return comparison !== null && comparison < 0;
}

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === '/') {
    return '/';
  }

  const withLeadingSlash = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

export function buildReleaseManifestUrl(origin: string, basePath = import.meta.env.BASE_URL): string {
  const normalizedBasePath = normalizeBasePath(basePath);
  return new URL(`${normalizedBasePath}${RELEASE_MANIFEST_NAME}`, origin).toString();
}

export async function checkForPublishedRelease({
  basePath = import.meta.env.BASE_URL,
  currentVersion = APP_VERSION,
  fetcher = (input, init) => fetch(input, init),
  now = () => Date.now(),
  origin = window.location.origin,
  protocol = window.location.protocol,
  reload = () => window.location.reload(),
  sessionStore = window.sessionStorage,
}: CheckForPublishedReleaseOptions = {}): Promise<boolean> {
  if (!/^https?:$/u.test(protocol)) {
    return false;
  }

  const manifestUrl = buildReleaseManifestUrl(origin, basePath);

  try {
    const response = await fetcher(`${manifestUrl}?t=${now()}`, { cache: 'no-store' });
    if (!response.ok) {
      logWarn(RELEASE_REFRESH_SOURCE, `Release manifest request failed with status ${response.status}.`);
      return false;
    }

    const manifest = await response.json() as Partial<ReleaseManifest>;
    if (typeof manifest.version !== 'string' || manifest.version.trim().length === 0) {
      logWarn(RELEASE_REFRESH_SOURCE, 'Release manifest is missing a valid version string.');
      return false;
    }

    const publishedVersion = manifest.version.trim();
    if (!shouldForceRefreshForRelease(currentVersion, publishedVersion)) {
      return false;
    }

    const sessionKey = `${RELEASE_REFRESH_SESSION_KEY_PREFIX}${publishedVersion}`;
    if (sessionStore.getItem(sessionKey) === 'done') {
      return false;
    }

    sessionStore.setItem(sessionKey, 'done');
    logInfo(RELEASE_REFRESH_SOURCE, `Refreshing the page for deployed release v${publishedVersion}.`);
    reload();
    return true;
  } catch (error) {
    logError(RELEASE_REFRESH_SOURCE, error);
    return false;
  }
}
