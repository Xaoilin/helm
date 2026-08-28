import type {
  BoundedReminderKind,
  BoundedReminderReceipt,
  DailyMomentumState,
  DailyPillar,
  PrayerName,
  PrayerScheduleEntry,
  PrayerTrackingState,
} from '../types/domain';
import { getDailyMomentumPillarDay } from './dailyMomentum';
import {
  CANONICAL_PRAYER_NAMES,
  getPrayerDeadlineBounds,
  getPrayerOutcome,
} from './prayerTracking';

export const NON_PRAYER_QUIET_HOURS = { startHour: 22, endHour: 8 } as const;

export interface BoundedReminderPlan {
  notificationKey: string;
  receiptKeys: string[];
  date: string;
  kind: BoundedReminderKind;
  fireAt: Date;
  expiresAt: Date;
  prayerNames: PrayerName[];
  pillars: DailyPillar[];
  title: string;
  body: string;
}

export interface BuildBoundedReminderPlanInput {
  prayerDate: string;
  schedule: readonly PrayerScheduleEntry[];
  tracking: PrayerTrackingState;
  momentum: DailyMomentumState;
  reminderMinutes: number;
}

function keyPart(value: Date): number {
  return value.getTime();
}

export function isNonPrayerQuietHour(value: Date): boolean {
  const hour = value.getHours();
  return hour >= NON_PRAYER_QUIET_HOURS.startHour || hour < NON_PRAYER_QUIET_HOURS.endHour;
}

function quietHoursStart(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, NON_PRAYER_QUIET_HOURS.startHour, 0, 0, 0);
}

function prayerStart(
  schedule: readonly PrayerScheduleEntry[],
  prayerDate: string,
  prayerName: PrayerName,
): Date | null {
  return getPrayerDeadlineBounds(schedule, prayerDate, prayerName)?.startsAt ?? null;
}

function momentumReceiptKey(
  date: string,
  pillar: DailyPillar,
  prayerName: PrayerName,
  fireAt: Date,
): string {
  return `bounded:v1:momentum:${date}:${pillar}:${prayerName}:${keyPart(fireAt)}`;
}

function opportunityReceiptKey(date: string, prayerName: PrayerName, fireAt: Date): string {
  return `bounded:v1:prayer-opportunity:${date}:${prayerName}:${keyPart(fireAt)}`;
}

export function buildBoundedReminderPlan({
  prayerDate,
  schedule,
  tracking,
  momentum,
  reminderMinutes,
}: BuildBoundedReminderPlanInput): BoundedReminderPlan[] {
  const plans: BoundedReminderPlan[] = [];
  const deadlineGroups = new Map<number, { deadlineAt: Date; names: PrayerName[]; deadlineName: string }>();

  for (const prayerName of CANONICAL_PRAYER_NAMES) {
    if (getPrayerOutcome(tracking, prayerDate, prayerName)) continue;
    const bounds = getPrayerDeadlineBounds(schedule, prayerDate, prayerName);
    if (!bounds) continue;

    plans.push({
      notificationKey: opportunityReceiptKey(prayerDate, prayerName, bounds.startsAt),
      receiptKeys: [opportunityReceiptKey(prayerDate, prayerName, bounds.startsAt)],
      date: prayerDate,
      kind: 'prayer-opportunity',
      fireAt: bounds.startsAt,
      expiresAt: new Date(Math.min(
        bounds.deadlineAt.getTime(),
        bounds.startsAt.getTime() + 30 * 60_000,
      )),
      prayerNames: [prayerName],
      pillars: [],
      title: `${prayerName} prayer opportunity`,
      body: `The ${prayerName} prayer opportunity has begun.`,
    });

    const deadlineKey = bounds.deadlineAt.getTime();
    const existing = deadlineGroups.get(deadlineKey);
    if (existing) existing.names.push(prayerName);
    else deadlineGroups.set(deadlineKey, {
      deadlineAt: bounds.deadlineAt,
      names: [prayerName],
      deadlineName: bounds.deadlineName,
    });
  }

  for (const group of deadlineGroups.values()) {
    const fireAt = new Date(group.deadlineAt.getTime() - reminderMinutes * 60_000);
    const names = group.names.join(' and ');
    plans.push({
      notificationKey: `bounded:v1:prayer-deadline:${prayerDate}:${keyPart(group.deadlineAt)}`,
      receiptKeys: group.names.map(name => `prayer:${prayerDate}:${name}:${keyPart(group.deadlineAt)}`),
      date: prayerDate,
      kind: 'prayer-deadline',
      fireAt,
      expiresAt: group.deadlineAt,
      prayerNames: [...group.names],
      pillars: [],
      title: `${names} prayer due soon`,
      body: `Pray ${names} before ${group.deadlineName}.`,
    });
  }

  const momentumByFireAt = new Map<number, {
    fireAt: Date;
    expiresAt: Date;
    prayerName: PrayerName;
    pillars: DailyPillar[];
    receiptKeys: string[];
  }>();
  const quietStart = quietHoursStart(prayerDate);

  for (const pillar of ['learn', 'move'] as const) {
    const preference = momentum.reminderPreferences[pillar];
    if (!preference.enabled || getDailyMomentumPillarDay(momentum, prayerDate, pillar).complete) continue;
    const anchors = preference.afterPrayers
      .map(prayerName => ({ prayerName, fireAt: prayerStart(schedule, prayerDate, prayerName) }))
      .filter((anchor): anchor is { prayerName: PrayerName; fireAt: Date } => Boolean(anchor.fireAt))
      .sort((left, right) => left.fireAt.getTime() - right.fireAt.getTime());

    anchors.forEach((anchor, index) => {
      if (isNonPrayerQuietHour(anchor.fireAt)) return;
      const nextAnchor = anchors[index + 1]?.fireAt;
      const expiresAt = new Date(Math.min(
        nextAnchor?.getTime() ?? Number.POSITIVE_INFINITY,
        quietStart.getTime(),
      ));
      if (expiresAt <= anchor.fireAt) return;
      const receiptKey = momentumReceiptKey(prayerDate, pillar, anchor.prayerName, anchor.fireAt);
      const fireKey = anchor.fireAt.getTime();
      const existing = momentumByFireAt.get(fireKey);
      if (existing) {
        existing.pillars.push(pillar);
        existing.receiptKeys.push(receiptKey);
        existing.expiresAt = new Date(Math.min(existing.expiresAt.getTime(), expiresAt.getTime()));
      } else {
        momentumByFireAt.set(fireKey, {
          fireAt: anchor.fireAt,
          expiresAt,
          prayerName: anchor.prayerName,
          pillars: [pillar],
          receiptKeys: [receiptKey],
        });
      }
    });
  }

  for (const group of momentumByFireAt.values()) {
    const labels = group.pillars.map(pillar => pillar === 'learn' ? 'Learn' : 'Move');
    const joined = labels.join(' and ');
    plans.push({
      notificationKey: `bounded:v1:momentum:${prayerDate}:${keyPart(group.fireAt)}:${group.pillars.join('+')}`,
      receiptKeys: [...group.receiptKeys],
      date: prayerDate,
      kind: 'momentum',
      fireAt: group.fireAt,
      expiresAt: group.expiresAt,
      prayerNames: [group.prayerName],
      pillars: [...group.pillars],
      title: `${joined} — Level 1`,
      body: `${group.prayerName} has begun. Complete today's ${joined} Level 1.`,
    });
  }

  return plans.sort((left, right) => (
    left.fireAt.getTime() - right.fireAt.getTime()
    || left.kind.localeCompare(right.kind)
    || left.notificationKey.localeCompare(right.notificationKey)
  ));
}

function receiptFor(
  receipts: Record<string, BoundedReminderReceipt>,
  receiptKey: string,
): BoundedReminderReceipt | undefined {
  return receipts[receiptKey];
}

function snoozeAllows(
  receipts: Record<string, BoundedReminderReceipt>,
  plan: BoundedReminderPlan,
  now: Date,
): boolean {
  return plan.receiptKeys.every(receiptKey => {
    const snoozedUntil = receiptFor(receipts, receiptKey)?.snoozedUntil;
    return !snoozedUntil || Date.parse(snoozedUntil) <= now.getTime();
  });
}

export function getAttemptableBoundedReminders(
  plans: readonly BoundedReminderPlan[],
  receipts: Record<string, BoundedReminderReceipt>,
  now: Date,
): BoundedReminderPlan[] {
  return plans.filter(plan => (
    plan.kind !== 'prayer-deadline'
    && plan.fireAt <= now
    && now < plan.expiresAt
    && snoozeAllows(receipts, plan, now)
    && plan.receiptKeys.some(receiptKey => !receiptFor(receipts, receiptKey)?.attemptedAt)
  ));
}

export function getActiveBoundedReminder(
  plans: readonly BoundedReminderPlan[],
  receipts: Record<string, BoundedReminderReceipt>,
  now: Date,
): BoundedReminderPlan | null {
  return [...plans]
    .filter(plan => (
      plan.kind !== 'prayer-deadline'
      && plan.fireAt <= now
      && now < plan.expiresAt
      && snoozeAllows(receipts, plan, now)
    ))
    .sort((left, right) => (
      Number(right.kind === 'prayer-opportunity') - Number(left.kind === 'prayer-opportunity')
      || right.fireAt.getTime() - left.fireAt.getTime()
      || right.notificationKey.localeCompare(left.notificationKey)
    ))[0] ?? null;
}

export function recordBoundedReminderAttempt(
  state: PrayerTrackingState,
  plan: BoundedReminderPlan,
  attemptedAt: Date,
  notified: boolean,
): PrayerTrackingState {
  const attemptedAtIso = attemptedAt.toISOString();
  const boundedReminderReceipts = { ...state.boundedReminderReceipts };
  for (const notificationKey of plan.receiptKeys) {
    const existing = boundedReminderReceipts[notificationKey];
    boundedReminderReceipts[notificationKey] = {
      ...existing,
      notificationKey,
      date: plan.date,
      kind: plan.kind,
      attemptedAt: existing?.attemptedAt ?? attemptedAtIso,
      ...(notified ? { notifiedAt: existing?.notifiedAt ?? attemptedAtIso } : {}),
      snoozeCount: existing?.snoozeCount ?? 0,
    };
  }
  return { ...state, boundedReminderReceipts };
}

export function canSnoozeBoundedReminder(
  state: PrayerTrackingState,
  plan: BoundedReminderPlan,
  snoozedUntil: Date,
): boolean {
  return snoozedUntil < plan.expiresAt && plan.receiptKeys.every(receiptKey => (
    (state.boundedReminderReceipts[receiptKey]?.snoozeCount ?? 0) < 1
  ));
}

export function snoozeBoundedReminder(
  state: PrayerTrackingState,
  plan: BoundedReminderPlan,
  snoozedUntil: Date,
): PrayerTrackingState {
  if (!canSnoozeBoundedReminder(state, plan, snoozedUntil)) {
    throw new Error('This reminder has already used its one snooze.');
  }
  const boundedReminderReceipts = { ...state.boundedReminderReceipts };
  for (const notificationKey of plan.receiptKeys) {
    const existing = boundedReminderReceipts[notificationKey];
    boundedReminderReceipts[notificationKey] = {
      ...existing,
      notificationKey,
      date: plan.date,
      kind: plan.kind,
      snoozedUntil: snoozedUntil.toISOString(),
      snoozeCount: 1,
    };
  }
  return { ...state, boundedReminderReceipts };
}
