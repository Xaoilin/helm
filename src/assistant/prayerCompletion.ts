import type { PrayerCompletionStatus, PrayerName } from '../types/domain';
import type { AssistantLang } from './shared';

const ON_TIME_REPLIES = new Set([
  'on time',
  'on-time',
  'on time prayer',
  'on-time prayer',
  'it was on time',
  'it was an on time prayer',
  'it was an on-time prayer',
  'actually on time',
  'actually it was on time',
  'no on time',
  'no it was on time',
  'i prayed on time',
  'prayed on time',
  'في الوقت',
  'في وقتها',
  'صليتها في الوقت',
]);

const LATE_REPLIES = new Set([
  'late',
  'late prayer',
  'it was late',
  'it was a late prayer',
  'actually late',
  'actually it was late',
  'no late',
  'no it was late',
  'i prayed late',
  'prayed late',
  'qada',
  'qadha',
  'متأخرة',
  'متأخر',
  'صليتها متأخرة',
]);

function normaliseReply(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[.,!?؟،]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parsePrayerCompletionStatusReply(
  value: string,
): PrayerCompletionStatus | null {
  const normalised = normaliseReply(value);
  if (ON_TIME_REPLIES.has(normalised)) return 'on_time';
  if (LATE_REPLIES.has(normalised)) return 'late';
  return null;
}

export function buildPrayerStatusQuestion(
  prayerName: PrayerName,
  lang: AssistantLang,
): string {
  return lang === 'ar'
    ? `هل كانت صلاة ${prayerName} في وقتها أم متأخرة؟`
    : 'On time or late?';
}
