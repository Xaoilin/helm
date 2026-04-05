import type { PrayerTime as PrayerTimeType } from '../../services/prayerTimes';

interface AdhanBannerProps {
  adhanPrayer: PrayerTimeType;
  onDismiss: () => void;
}

export default function AdhanBanner({ adhanPrayer, onDismiss }: AdhanBannerProps) {
  return (
    <div className="adhan-banner" onClick={onDismiss}>
      <div className="adhan-ring" />
      <div className="adhan-ring" />
      <div className="adhan-ring" />
      <div className="adhan-content">
        <div className="adhan-mosque">{'\u{1F54C}'}</div>
        <div className="adhan-text">
          <div className="adhan-title">{'\u0627\u0644\u0644\u0647 \u0623\u0643\u0628\u0631'}</div>
          <div className="adhan-subtitle">Allahu Akbar</div>
          <div className="adhan-subtitle">It's time for <strong>{adhanPrayer.name}</strong> ({adhanPrayer.nameArabic})</div>
          <div className="adhan-time">{adhanPrayer.time}</div>
        </div>
      </div>
      <div className="adhan-dismiss">Tap anywhere when you're ready to dismiss</div>
    </div>
  );
}
