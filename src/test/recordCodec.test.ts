import { describe, expect, it } from 'vitest';
import {
  decodeStoreValue,
  encodeStoreValue,
  mergeLegacyStoreValue,
  splitSettings,
} from '../store/recordCodec';
import {
  createDefaultDailyMomentumState,
  getDailyMomentumPillarState,
} from '../services/dailyMomentum';
import { DEFAULT_PROFILE } from '../services/gamification';

describe('Sabah One record codec', () => {
  it('preserves stable ids and explicit collection ordering', () => {
    const projects = [
      { id: 'project-b', name: 'B', isPinned: false },
      { id: 'project-a', name: 'A', isPinned: true },
    ];

    const records = encodeStoreValue('projects', projects);

    expect(records.map(record => [record.recordId, record.position])).toEqual([
      ['project-b', 0],
      ['project-a', 1],
    ]);
    expect(decodeStoreValue('projects', [...records].reverse())).toEqual(projects);
  });

  it('keeps device credentials and paths out of shared settings', () => {
    const split = splitSettings({
      theme: 'dark',
      telemetry: false,
      deepgramApiKey: 'secret-key',
      microphoneDeviceId: 'device-mic',
      ollamaEndpoint: 'http://127.0.0.1:11434',
      0: { id: 'malformed-integration' },
    });

    expect(split.shared).toEqual({ theme: 'dark', telemetry: false });
    expect(split.device).toEqual({
      deepgramApiKey: 'secret-key',
      microphoneDeviceId: 'device-mic',
      ollamaEndpoint: 'http://127.0.0.1:11434',
    });
    expect(encodeStoreValue('settings', split.shared)[0].payload).not.toHaveProperty('0');
  });

  it('adds valid local-only records while database records and fields win', () => {
    const merged = mergeLegacyStoreValue(
      'knowledgeEntries',
      [
        { id: 'database-only', title: 'Database only' },
        { id: 'matching', title: 'Database title' },
      ],
      [
        { id: 'matching', title: 'Device title', content: 'Safe missing field' },
        { id: 'local-only', title: 'Local only' },
        { title: 'Malformed without stable id' },
      ],
    );

    expect(merged).toEqual([
      { id: 'database-only', title: 'Database only' },
      { id: 'matching', title: 'Database title', content: 'Safe missing field' },
      { id: 'local-only', title: 'Local only' },
    ]);
  });

  it('never sums matching legacy counters', () => {
    const merged = mergeLegacyStoreValue(
      'gamification',
      {
        totalXp: 100,
        habitTallies: { existing: 4 },
        dailyLog: {},
        prayerCompletionLedger: {},
      },
      {
        totalXp: 250,
        habitTallies: { existing: 8, localOnly: 2 },
        dailyLog: {},
        prayerCompletionLedger: {},
      },
    ) as Record<string, unknown>;

    expect(merged.totalXp).toBe(100);
    expect(merged.habitTallies).toEqual({ existing: 4, localOnly: 2 });
  });

  it('rejects active array records without a stable id', () => {
    expect(() => encodeStoreValue('tasks', [{ title: 'Ambiguous task' }])).toThrow(/stable id/i);
  });

  it('keeps retired Capture payloads decode-only for recovery tooling', () => {
    expect(decodeStoreValue('captureItems', [{
      recordId: 'legacy-capture',
      payload: { id: 'legacy-capture', content: 'Historical note' },
      position: 0,
    }])).toEqual([{ id: 'legacy-capture', content: 'Historical note' }]);
    expect(() => encodeStoreValue('captureItems', [])).toThrow(/retired/i);
  });

  it('round-trips daily momentum as an additive field on the older-reader-tolerant profile record', () => {
    const value = {
      ...DEFAULT_PROFILE,
      prayerCompletionLedger: {},
      dailyMomentumLearn: {
        ...getDailyMomentumPillarState(createDefaultDailyMomentumState(), 'learn'),
        unknownOlderField: { retained: true },
      },
      dailyMomentumMove: getDailyMomentumPillarState(createDefaultDailyMomentumState(), 'move'),
    };

    const records = encodeStoreValue('gamification', value);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ recordId: 'profile', position: null });
    expect(decodeStoreValue('gamification', records)).toEqual(value);
  });
});
