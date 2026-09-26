import { useCallback, useEffect, useRef, useState } from 'react';
import { isAdhanTime, type PrayerTime, type PrayerTimesData } from '../../../services/prayerTimes';

export interface PrayerAdhanInput {
  prayerEnabled: boolean;
  /** Today's timetable, only when its zone is verified. */
  timetable: PrayerTimesData | null;
  now: Date;
  today: string;
}

export interface PrayerAdhan {
  adhanPrayer: PrayerTime | null;
  dismissAdhan: () => void;
}

/** Shows the adhan overlay once per prayer per day, during the minute the prayer begins. */
export function usePrayerAdhan({ prayerEnabled, timetable, now, today }: PrayerAdhanInput): PrayerAdhan {
  const [adhanPrayer, setAdhanPrayer] = useState<PrayerTime | null>(null);
  const shownKeysRef = useRef(new Set<string>());

  useEffect(() => {
    if (!prayerEnabled || !timetable) return;
    const adhan = isAdhanTime(timetable.prayers, now, timetable.timezone);
    if (!adhan) return;
    const key = `${today}:${adhan.name}`;
    if (shownKeysRef.current.has(key)) return;
    shownKeysRef.current.add(key);
    setAdhanPrayer(adhan);
  }, [now, prayerEnabled, timetable, today]);

  const dismissAdhan = useCallback(() => setAdhanPrayer(null), []);

  return { adhanPrayer, dismissAdhan };
}
