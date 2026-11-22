import { useState } from 'react';
import linaPeriodGift from '../../assets/lina-period-gift.webp';
import './prayer-exemption-gift.css';

export default function PrayerExemptionGift() {
  const [motionPaused, setMotionPaused] = useState(false);
  const motionLabel = motionPaused ? 'استئناف الحركة' : 'إيقاف الحركة مؤقتًا';

  return <div className="prayer-challenge-gift" data-motion-paused={motionPaused}>
    <div className="prayer-challenge-gift-copy">
      <h3>هدية من الله</h3>
      <p>الصلاة غير واجبة عليكِ في هذه الأيام. ارتاحي يا لينا، واطمئنّي.</p>
    </div>
    <div className="prayer-challenge-gift-art" aria-hidden="true">
      <span className="prayer-challenge-gift-hearts">💕</span>
      <img src={linaPeriodGift} alt="" width="384" height="384" />
      <span className="prayer-challenge-gift-sparkles">✨</span>
    </div>
    <button type="button" className="prayer-gift-motion-toggle" aria-label={motionLabel} title={motionLabel}
      onClick={() => setMotionPaused(paused => !paused)}>
      <span className="prayer-gift-motion-icon" aria-hidden="true" />
    </button>
  </div>;
}
