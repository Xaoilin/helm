import AdhanBanner from '../dashboard/AdhanBanner';
import { usePrayerContext } from '../../store/contexts/PrayerContext';
import PrayerCompletionDialog from './PrayerCompletionDialog';
import PrayerCompletionNotice from './PrayerCompletionNotice';
import PrayerReminderBanner from './PrayerReminderBanner';
import BoundedReminderBanner from './BoundedReminderBanner';

export default function PrayerGlobalOverlays() {
  const prayer = usePrayerContext();

  return (
    <>
      <PrayerReminderBanner />
      <BoundedReminderBanner />
      <PrayerCompletionDialog />
      <PrayerCompletionNotice />
      {prayer.adhanPrayer && (
        <AdhanBanner adhanPrayer={prayer.adhanPrayer} onDismiss={prayer.dismissAdhan} />
      )}
    </>
  );
}
