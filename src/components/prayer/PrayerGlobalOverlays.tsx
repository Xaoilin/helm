import PrayerCompletionDialog from './PrayerCompletionDialog';
import PrayerCompletionNotice from './PrayerCompletionNotice';

export default function PrayerGlobalOverlays() {
  return (
    <>
      <PrayerCompletionDialog />
      <PrayerCompletionNotice />
    </>
  );
}
