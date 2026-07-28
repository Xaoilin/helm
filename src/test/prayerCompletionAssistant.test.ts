import {
  buildPrayerStatusQuestion,
  parsePrayerCompletionStatusReply,
} from '../assistant/prayerCompletion';

describe('assistant prayer completion clarification', () => {
  it.each([
    ['on time', 'on_time'],
    ['It was on time.', 'on_time'],
    ['It was a late prayer.', 'late'],
    ['No, it was late.', 'late'],
    ['Qadha', 'late'],
  ] as const)('strictly maps %s to %s', (reply, expected) => {
    expect(parsePrayerCompletionStatusReply(reply)).toBe(expected);
  });

  it('rejects replies that do not classify the prayer', () => {
    expect(parsePrayerCompletionStatusReply('around breakfast')).toBeNull();
    expect(parsePrayerCompletionStatusReply('probably')).toBeNull();
  });

  it('builds direct bilingual clarification copy', () => {
    expect(buildPrayerStatusQuestion('Fajr', 'en')).toBe('On time or late?');
    expect(buildPrayerStatusQuestion('Isha', 'ar')).toContain('في وقتها أم متأخرة');
  });
});
