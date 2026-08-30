import { getAppDate } from './appTimeZone';
import { validateIanaTimeZone } from './timeZone';
import type { LifeHeroEvidenceInput } from '../types/domain';

export const APPLE_HEALTH_MAX_EXPORT_BYTES = 25 * 1024 * 1024;
const MAX_SOURCE_LABEL_LENGTH = 200;
const DAY_IN_MILLISECONDS = 86_400_000;
export type AppleHealthMovementType = 'stepCount' | 'distanceWalkingRunning';

function movementTypeForRecord(record: Element): AppleHealthMovementType | null {
  const type = readAttribute(record, 'type');
  if (type === 'HKQuantityTypeIdentifierStepCount') return 'stepCount';
  if (type === 'HKQuantityTypeIdentifierDistanceWalkingRunning') return 'distanceWalkingRunning';
  return null;
}

export interface AppleHealthMovementDay {
  localDate: string;
  movementTypes: readonly AppleHealthMovementType[];
}

export interface AppleHealthMovementExport {
  sourceLabel: string;
  dateRange: { start: string; end: string };
  freshness: { exportedAt: string; ageDays: number };
  days: readonly AppleHealthMovementDay[];
}

export interface AppleHealthMovementImportReceipt {
  sourceLabel: string;
  dateRange: { start: string; end: string };
  freshness: { exportedAt: string; ageDays: number };
  importedDays: number;
  accepted: number;
  duplicates: number;
}

export interface ParseAppleHealthMovementOptions {
  timeZone: string;
  now?: Date;
  selectedSourceLabel?: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function normalizeSourceLabel(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function readAttribute(element: Element, name: string): string {
  return element.getAttribute(name)?.trim() ?? '';
}

function parseHealthDate(value: string, label: string): Date {
  const trimmed = value.trim();
  if (!trimmed || !/(?:Z|[+-]\d{2}:?\d{2})$/iu.test(trimmed)) {
    fail(`Apple Health ${label} must include an explicit time zone.`);
  }

  const normalized = trimmed.replace(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(Z|[+-]\d{2}:?\d{2})$/iu,
    '$1T$2$3',
  );
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) fail(`Apple Health ${label} is invalid.`);
  return parsed;
}

function parseXml(xml: string): Document {
  if (!xml.trim()) fail('Choose a non-empty Apple Health XML export.');
  if (xml.length > APPLE_HEALTH_MAX_EXPORT_BYTES) {
    fail('This Apple Health export is too large to import safely.');
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    fail('Apple Health XML with declarations or entities is not supported.');
  }
  if (typeof DOMParser === 'undefined') {
    fail('Apple Health XML import is available in the hosted browser only.');
  }

  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    fail('The Apple Health XML export is malformed.');
  }
  if (document.documentElement?.localName !== 'HealthData') {
    fail('The selected file is not an Apple Health export.');
  }
  return document;
}

function sourceDetails(record: Element): { identity: string; label: string } {
  const sourceName = normalizeSourceLabel(readAttribute(record, 'sourceName'));
  const device = normalizeSourceLabel(readAttribute(record, 'device'));
  const label = sourceName || device;
  if (!label || label.length > MAX_SOURCE_LABEL_LENGTH) {
    fail('Apple Health movement records need a bounded source or device label.');
  }
  return {
    identity: `${sourceName}\u001f${device}`,
    label,
  };
}

function isEligibleIPhoneSource(record: Element): boolean {
  const sourceName = readAttribute(record, 'sourceName');
  const device = readAttribute(record, 'device');
  const combined = `${sourceName} ${device}`;
  return /iphone/iu.test(combined) && !/watch/iu.test(combined);
}

function readExportedAt(document: Document): Date {
  const exportDate = document.getElementsByTagName('ExportDate')[0];
  if (!exportDate) fail('The Apple Health export is missing its export date.');
  return parseHealthDate(readAttribute(exportDate, 'value'), 'export date');
}

function sourceDateKey(sourceLabel: string, localDate: string): string {
  return `apple-health\u001f${sourceLabel}\u001f${localDate}`;
}

async function sha256Hex(value: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    fail('This browser cannot provide the secure Apple Health duplicate identity.');
  }
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function parseAppleHealthMovementExport(
  xml: string,
  options: ParseAppleHealthMovementOptions,
): AppleHealthMovementExport {
  if (!validateIanaTimeZone(options.timeZone)) {
    fail('Apple Health movement needs a valid app time zone.');
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) fail('Apple Health movement needs a valid current time.');

  const document = parseXml(xml);
  const exportedAt = readExportedAt(document);
  if (exportedAt.getTime() > now.getTime()) fail('Apple Health export dates cannot be in the future.');

  const supportedRecords = Array.from(document.getElementsByTagName('Record'))
    .filter(record => movementTypeForRecord(record) !== null);
  const eligibleRecords = supportedRecords.filter(isEligibleIPhoneSource);
  if (eligibleRecords.length === 0) {
    fail('No supported iPhone movement records were found in this export.');
  }

  const sources = new Map<string, string>();
  for (const record of eligibleRecords) {
    const source = sourceDetails(record);
    sources.set(source.identity, source.label);
  }
  const selectedSourceLabel = options.selectedSourceLabel?.trim();
  const selectedSource = selectedSourceLabel
    ? [...sources.entries()].find(([, label]) => label === selectedSourceLabel)
    : sources.size === 1
      ? [...sources.entries()][0]
      : undefined;
  if (!selectedSource) {
    fail('Select one unambiguous iPhone Health source before importing.');
  }

  const days = new Map<string, Set<AppleHealthMovementType>>();
  for (const record of eligibleRecords) {
    const source = sourceDetails(record);
    if (source.identity !== selectedSource[0]) continue;
    const type = movementTypeForRecord(record);
    if (!type) continue;

    const startDate = parseHealthDate(readAttribute(record, 'startDate'), 'movement start date');
    const endDate = parseHealthDate(readAttribute(record, 'endDate'), 'movement end date');
    if (endDate.getTime() < startDate.getTime()) fail('Apple Health movement dates are out of order.');
    if (endDate.getTime() > now.getTime()) fail('Apple Health movement dates cannot be in the future.');

    const rawValue = readAttribute(record, 'value');
    const value = Number(rawValue);
    if (!rawValue || !Number.isFinite(value) || value < 0) {
      fail('Apple Health movement values must be finite and non-negative.');
    }
    if (value === 0) continue;

    const localDate = getAppDate(startDate, options.timeZone);
    if (!localDate) fail('Apple Health movement time-zone conversion failed.');
    const movementTypes = days.get(localDate) ?? new Set<AppleHealthMovementType>();
    movementTypes.add(type);
    days.set(localDate, movementTypes);
  }

  if (days.size === 0) fail('No positive iPhone movement was found in this export.');
  const sortedDates = [...days.keys()].sort();
  const ageDays = Math.max(0, Math.floor((now.getTime() - exportedAt.getTime()) / DAY_IN_MILLISECONDS));
  return {
    sourceLabel: selectedSource[1],
    dateRange: { start: sortedDates[0], end: sortedDates[sortedDates.length - 1] },
    freshness: { exportedAt: exportedAt.toISOString(), ageDays },
    days: sortedDates.map(localDate => ({
      localDate,
      movementTypes: [...(days.get(localDate) ?? [])].sort(),
    })),
  };
}

export async function createAppleHealthEvidenceInputs(
  parsed: AppleHealthMovementExport,
): Promise<LifeHeroEvidenceInput[]> {
  return Promise.all(parsed.days.map(async day => {
    const digest = await sha256Hex(sourceDateKey(parsed.sourceLabel, day.localDate));
    return {
      idempotencyKey: `apple-health:${digest}`,
      evidenceType: 'vitality_activity',
      sourceTier: 'self_reported',
      sourceReference: `apple-health:${digest}`,
      occurredAt: parsed.freshness.exportedAt,
      localDate: day.localDate,
      metadata: {
        provider: 'apple_health',
        source: parsed.sourceLabel,
        dateRangeStart: parsed.dateRange.start,
        dateRangeEnd: parsed.dateRange.end,
        exportedAt: parsed.freshness.exportedAt,
        freshnessAgeDays: parsed.freshness.ageDays,
        movementTypes: day.movementTypes.join(','),
        sourceDateDigest: digest,
      },
    } satisfies LifeHeroEvidenceInput;
  }));
}

export type AppleHealthEvidenceAcceptor = (
  input: LifeHeroEvidenceInput,
) => Promise<{ duplicate: boolean }>;

export async function submitAppleHealthMovementEvidence(
  parsed: AppleHealthMovementExport,
  acceptEvidence: AppleHealthEvidenceAcceptor,
): Promise<AppleHealthMovementImportReceipt> {
  const inputs = await createAppleHealthEvidenceInputs(parsed);
  let accepted = 0;
  let duplicates = 0;
  for (const input of inputs) {
    const result = await acceptEvidence(input);
    if (result.duplicate) duplicates += 1;
    else accepted += 1;
  }
  return {
    sourceLabel: parsed.sourceLabel,
    dateRange: parsed.dateRange,
    freshness: parsed.freshness,
    importedDays: parsed.days.length,
    accepted,
    duplicates,
  };
}
