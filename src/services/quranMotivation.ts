import type { QuranMotivationCard } from '../types/domain';

/**
 * Source-reviewed static Quran motivation. Arabic and references were checked
 * against the linked Quran.com pages; summaries are deliberately labelled as
 * contextual paraphrases rather than translations.
 */
export const QURAN_MOTIVATION_CARDS: readonly QuranMotivationCard[] = [
  {
    id: 'quran-20-14',
    title: 'Establish prayer for remembrance',
    arabic: 'إِنَّنِىٓ أَنَا ٱللَّهُ لَآ إِلَـٰهَ إِلَّآ أَنَا۠ فَٱعْبُدْنِى وَأَقِمِ ٱلصَّلَوٰةَ لِذِكْرِىٓ ١٤',
    reference: '20:14',
    meaningSummary: 'Allah identifies Himself as the only deity and directs worship to Him; prayer is established as an act of remembering Him.',
    sourceUrl: 'https://quran.com/20/14',
  },
  {
    id: 'quran-2-45',
    title: 'Seek help through patience and prayer',
    arabic: 'وَٱسْتَعِينُوا۟ بِٱلصَّبْرِ وَٱلصَّلَوٰةِ ۚ وَإِنَّهَا لَكَبِيرَةٌ إِلَّا عَلَى ٱلْخَـٰشِعِينَ ٤٥',
    reference: '2:45',
    meaningSummary: 'Patience and prayer are presented as means of seeking help; this can be difficult except for the humble.',
    sourceUrl: 'https://quran.com/2/45',
  },
  {
    id: 'quran-29-69',
    title: 'Strive and be guided',
    arabic: 'وَٱلَّذِينَ جَـٰهَدُوا۟ فِينَا لَنَهْدِيَنَّهُمْ سُبُلَنَا ۚ وَإِنَّ ٱللَّهَ لَمَعَ ٱلْمُحْسِنِينَ ٦٩',
    reference: '29:69',
    meaningSummary: 'Those who strive in Allah’s cause are promised guidance toward His ways, and Allah is said to be with those who do good.',
    sourceUrl: 'https://quran.com/29/69',
  },
  {
    id: 'quran-53-39',
    title: 'Each person has what they strive for',
    arabic: 'وَأَن لَّيْسَ لِلْإِنسَـٰنِ إِلَّا مَا سَعَىٰ ٣٩',
    reference: '53:39',
    meaningSummary: 'Each person is described as receiving only what they have personally striven for.',
    sourceUrl: 'https://quran.com/53/39',
  },
  {
    id: 'quran-13-28',
    title: 'Hearts find comfort in remembrance',
    arabic: 'ٱلَّذِينَ ءَامَنُوا۟ وَتَطْمَئِنُّ قُلُوبُهُم بِذِكْرِ ٱللَّهِ ۗ أَلَا بِذِكْرِ ٱللَّهِ تَطْمَئِنُّ ٱلْقُلُوبُ ٢٨',
    reference: '13:28',
    meaningSummary: 'Believers’ hearts are described as finding comfort through remembering Allah; the verse repeats that remembrance brings comfort.',
    sourceUrl: 'https://quran.com/13/28',
  },
  {
    id: 'quran-94-5-6',
    title: 'With hardship comes ease',
    arabic: 'فَإِنَّ مَعَ ٱلْعُسْرِ يُسْرًا ٥\nإِنَّ مَعَ ٱلْعُسْرِ يُسْرًۭا ٦',
    reference: '94:5-6',
    meaningSummary: 'The paired verses state that hardship is accompanied by ease.',
    sourceUrl: 'https://quran.com/94/5-6',
  },
] as const;

export function getQuranMotivationForDate(localDate: string): QuranMotivationCard {
  const digits = localDate.replace(/\D/gu, '');
  const index = Number(digits || 0) % QURAN_MOTIVATION_CARDS.length;
  return QURAN_MOTIVATION_CARDS[index]!;
}
