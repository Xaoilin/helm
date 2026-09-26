import type { PrayerTimesData } from '../services/prayerTimes';

export const PRAYER_TEST_DATE = '2026-09-26';
export const PRAYER_TEST_ZONE = 'Europe/London';

/**
 * A complete, valid AlAdhan-shaped timetable. London is UTC+1 on the default
 * date, so Dhuhr starts at 11:55Z and its deadline (Asr) is 15:20Z.
 */
export function makePrayerTimesData(
  date = PRAYER_TEST_DATE,
  timezone = PRAYER_TEST_ZONE,
): PrayerTimesData {
  return {
    prayers: [
      { name: 'Fajr', nameArabic: 'الفجر', time: '05:00', type: 'prayer' },
      { name: 'Sunrise', nameArabic: 'الشروق', time: '06:45', type: 'event' },
      { name: 'Dhuhr', nameArabic: 'الظهر', time: '12:55', type: 'prayer' },
      { name: 'Asr', nameArabic: 'العصر', time: '16:20', type: 'prayer' },
      { name: 'Sunset', nameArabic: 'غروب', time: '18:50', type: 'event' },
      { name: 'Maghrib', nameArabic: 'المغرب', time: '19:05', type: 'prayer' },
      { name: 'Isha', nameArabic: 'العشاء', time: '20:15', type: 'prayer' },
      { name: 'Midnight', nameArabic: 'نصف الليل', time: '00:30', type: 'event' },
    ],
    date,
    hijriDate: '',
    city: 'Bedford',
    country: 'United Kingdom',
    timezone,
    method: 'Shia Ithna-Ashari, Leva Institute, Qum',
    fetchedAt: `${date}T00:00:00.000Z`,
    source: 'cache',
  };
}
