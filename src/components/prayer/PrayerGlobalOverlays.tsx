import AdhanBanner from '../dashboard/AdhanBanner';
import { usePrayerContext } from '../../store/contexts/PrayerContext';
import PrayerCompletionDialog from './PrayerCompletionDialog';
import PrayerReminderBanner from './PrayerReminderBanner';

export default function PrayerGlobalOverlays() {
  const prayer = usePrayerContext();

  return (
    <>
      <PrayerReminderBanner />
      <PrayerCompletionDialog />
      {prayer.adhanPrayer && (
        <AdhanBanner adhanPrayer={prayer.adhanPrayer} onDismiss={prayer.dismissAdhan} />
      )}
    </>
  );
}
