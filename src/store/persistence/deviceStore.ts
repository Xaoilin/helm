import { logWarn } from '../../services/logger';
import { SHARED_STORE_KEYS } from '../storeKeys';
import type { LocalImportCandidate } from './types';

const NAMESPACE = 'helm';
const META_PREFIX = `${NAMESPACE}:meta:`;

export const DEVICE_SETTINGS_STORE_KEY = 'deviceSettings';
export type DeviceStoreKey = typeof DEVICE_SETTINGS_STORE_KEY;

export interface LegacyLocalValue {
  raw: string | null;
  value: unknown;
  hasValue: boolean;
  parseError: boolean;
  source: 'localStorage' | null;
}

export function isDeviceStoreKey(key: string): key is DeviceStoreKey {
  return key === DEVICE_SETTINGS_STORE_KEY;
}

function byteSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function localRawSnapshot(raw: string | null): {
  hasValue: boolean;
  value: unknown;
  parseError: boolean;
  sizeBytes: number;
} {
  if (raw === null) return { hasValue: false, value: null, parseError: false, sizeBytes: 0 };
  try {
    return { hasValue: true, value: JSON.parse(raw), parseError: false, sizeBytes: byteSize(raw) };
  } catch {
    return { hasValue: false, value: raw, parseError: true, sizeBytes: byteSize(raw) };
  }
}

/** Owns browser persistence keys and the one-way legacy quarantine policy. */
export class PersistenceDeviceStore {
  readLegacySharedValue(key: string): LegacyLocalValue {
    const raw = localStorage.getItem(this.sharedDataKey(key));
    const parsed = localRawSnapshot(raw);
    return {
      raw,
      value: parsed.value,
      hasValue: parsed.hasValue,
      parseError: parsed.parseError,
      source: parsed.hasValue || parsed.parseError ? 'localStorage' : null,
    };
  }

  quarantineLegacyValue(key: string, raw: string): void {
    const quarantineKey = `${NAMESPACE}:device:legacy-quarantine:${key}:${Date.now()}`;
    localStorage.setItem(quarantineKey, raw);
  }

  clearLegacySharedValue(key: string): void {
    localStorage.removeItem(this.sharedDataKey(key));
    localStorage.removeItem(`${META_PREFIX}${key}`);
  }

  listLegacyCandidates(remoteExists: (key: string) => boolean | null): LocalImportCandidate[] {
    const candidates: LocalImportCandidate[] = [];
    for (const item of SHARED_STORE_KEYS) {
      const raw = localStorage.getItem(this.sharedDataKey(item.key));
      const browser = localRawSnapshot(raw);
      if (!browser.hasValue && !browser.parseError) continue;
      candidates.push({
        key: item.key,
        label: item.label,
        description: item.description,
        localStorage: browser.hasValue || browser.parseError,
        remoteExists: remoteExists(item.key),
        sizeBytes: browser.sizeBytes,
      });
    }
    return candidates;
  }

  countLegacyCandidates(): number {
    return SHARED_STORE_KEYS.reduce((count, item) => (
      localStorage.getItem(this.sharedDataKey(item.key)) !== null ? count + 1 : count
    ), 0);
  }

  load<T>(key: DeviceStoreKey): T | null {
    const raw = localStorage.getItem(this.deviceDataKey(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      logWarn('Persistence', `Device-only cache JSON parse failed for ${key}`);
      return null;
    }
  }

  save<T>(key: DeviceStoreKey, value: T): void {
    localStorage.setItem(this.deviceDataKey(key), JSON.stringify(value));
  }

  private sharedDataKey(key: string): string {
    return `${NAMESPACE}:${key}`;
  }

  private deviceDataKey(key: string): string {
    return `${NAMESPACE}:device:${key}`;
  }
}
