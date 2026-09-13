# Daily Quran encouragement review

## Scope and editorial policy

The daily dashboard collection prioritizes salah, with related remembrance and
supplication, then encouragement toward patience and a good life. Each card is a
distinct, non-overlapping Quran passage, not a recombination of titles and text.
The resulting collection contains **206 cards across 374 distinct ayahs**:
57 prayer, 26 remembrance, 50 dua, 28 steadfastness, and 45 good-deeds cards.
Prayer and related devotion account for 133 cards (about 65%). These theme
labels describe the card's main focus; the prayer group also includes
prostration and night devotion, rather than being a count of occurrences of the
word salah.

This is a curated collection, not a claim that every suitable passage has been
exhausted or a scholarly tafsir certification.

The 2026-09-13 review uses the complete 114-surah, 6,236-ayah corpus, divided into
surahs 1–9 (1,364 ayahs), 10–32 (2,169), and 33–114 (2,703). Review includes the
surrounding text, the speaker and addressee, and any conditions attached to an
encouragement. The Arabic text is primary; Pickthall's English translation is a
reading aid. Quran.com provides a linked source and further context for each
selected passage.

Selection rules:

- Prefer explicit prayer passages, then worship, remembrance and dua.
- Include hopeful perseverance, gratitude, mercy, honesty and good deeds where
  the passage works as daily encouragement.
- Use complete ayahs, joining adjacent ayahs when needed to preserve meaning.
  Do not count a passage and its constituent ayahs as separate cards.
- Preserve prophetic or historical attribution and relevant conditions in the
  English summary. Do not turn a Prophet-specific command into a universal duty.
- Exclude isolated threats, combat instructions, unrelated detailed legal rulings and
  context-dependent fragments that would mislead on an encouragement card.
- Titles and summaries are editorial paraphrases, never presented as Quranic
  quotations, literal translations, new divine promises or guaranteed worldly
  success. No generated hadith or unsourced sayings are included.

## Sources and text integrity

- [Tanzil Quran text download](https://tanzil.net/download/): Uthmani v1.1,
  `txt-2`, pause marks, sajdah signs and tatweel enabled. Each selected Arabic
  record is copied unchanged. Multi-ayah cards join complete records with a
  newline. Chapter-opening basmala is retained as supplied by Tanzil.
- [AlQuran Cloud API](https://alquran.cloud/api): the complete `en.pickthall`
  edition supplied the sequential English review corpus. English translation
  text is not distributed as the app's summaries.
- [Quran Foundation Uthmani API documentation](https://api-docs.quran.com/docs/content_apis_versioned/4.0.0/quran-verses-uthmani/):
  the complete Quran.com Arabic corpus supplied a second text cross-check.
- [Tanzil text licence](https://tanzil.net/docs/Text_License): the original notice
  is preserved with the catalogue and in `public/licenses/tanzil-quran.txt`;
  the dashboard links to Tanzil and the distributed notice.

All 6,236 Arabic records agree between the two sources after excluding only
source-format differences for comparison: chapter-opening basmala outside 1:1,
rub-el-hizb markers and outer whitespace. The 95:1 and 97:1 preambles carry
Tanzil's shadda variant. These comparison operations are **not** applied to the
published Arabic text.

Downloaded input SHA-256 receipts:

| Input | SHA-256 |
| --- | --- |
| Tanzil Uthmani v1.1 text | `6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f` |
| AlQuran Cloud Pickthall JSON | `e731d9bce22575faba22b1f3de21c18b647711c33de074b89fe8d6f8384b01c5` |
| Quran.com Uthmani JSON | `3754c592dd15d7047d5b4339737ad3171c5c1d431a8c3e4c1eee7781c135d58c` |

The catalogue integrity test pins the selected reference-plus-Arabic digest
against the independently downloaded Tanzil records. Changing Arabic requires a
new source comparison and updated receipt; changing English requires context
review. The full source corpora are research inputs, not runtime dependencies.

Selected Arabic SHA-256: `2fbfdf6aa602f24fec44d6c23e04f87d06548afc87be2de44c9dfb9ad0f14d01`.
The input is UTF-8 `reference|arabic` records sorted lexically and joined with
newlines, without a trailing newline. Arabic within a range retains its own
newlines. There are no duplicate full Arabic cards or overlapping ayah ranges.

Final review corrected the righteous-offspring request in 37:100, shortened
70:19–35, 23:1–11 and 49:9–10 to their relevant prayer or reconciliation passages,
excluded Job's oath remedy and Noah's destruction request, and retained only one
copy of the identical 56:74/69:52 glorification. Additional direct prayer passages
were included without an arbitrary per-section cap. Prophet-specific commands
retain their addressee in the displayed summary; English wording was simplified
after source review. The full Arabic, including retained verse conditions, is
available on every card alongside the source link.

## Daily selection and verification

The prayer provider supplies the prayer schedule's local calendar date. The
selector counts calendar days, advancing through a fixed-seed Fisher-Yates
shuffle of every card exactly once before repeating. Keeping the shuffled order
stable prevents early repeats from any starting date, including across cycle
boundaries, and keeps devices in agreement. UTC is used only as a uniform day
counter, never to infer the user's date. Refreshing a page preserves that day's card; the provider's existing date
rollover updates it. There is no network call or model generation to choose a
card, and no account data or external agent API changes.

The former `YYYYMMDD % count` selector revisited entries across month ends; a
six-day run starting 2026-01-28 displayed only four distinct cards. Regression
coverage exercises complete cycles across month and year ends, leap day,
daylight-saving dates and dates before the Unix epoch. Browser coverage checks
the longest passage at phone, tablet and desktop widths, source links, reload
stability and an open page crossing a prayer-date boundary.

## Passage review ledger

Each entry was reviewed against its surrounding passage. The source link opens
the complete selected reference.

| Passage | Theme | Context retained in review |
| --- | --- | --- |
| [1:5-7](https://quran.com/1/5-7) | dua | The closing verses of Al-Faatiha form a first-person communal supplication within the chapter used in salah; the request is for guidance, not a worldly guarantee. |
| [2:3-5](https://quran.com/2/3-5) | prayer | These verses describe the qualities of the God-conscious at the opening of Al-Baqara, pairing salah with belief and spending rather than presenting prayer as an isolated act. |
| [2:43](https://quran.com/2/43) | prayer | The immediate address is to the Children of Israel in Al-Baqara; it is retained as a devotional pattern, with that historical audience preserved rather than treated as a new legal ruling. |
| [2:45-46](https://quran.com/2/45-46) | prayer | The passage addresses the Children of Israel after a call to keep covenant and worship; its encouragement links the emotional difficulty of prayer to eschatological awareness. |
| [2:110](https://quran.com/2/110) | prayer | This is a direct exhortation in the qiblah and community guidance of Al-Baqara; the reward language is tied to accountable action, not an earthly prosperity claim. |
| [2:152](https://quran.com/2/152) | remembrance | It follows teaching about the messenger and community direction; the concise imperative is general devotional guidance, with gratitude as its required response. |
| [2:153](https://quran.com/2/153) | prayer | This begins the passage on testing through fear, hunger, and loss; the reassurance is attached to perseverance through trials, not a promise that trials will not occur. |
| [2:186](https://quran.com/2/186) | dua | This appears in the Ramadan and fasting discussion, but the wording addresses supplication broadly; the answer includes both calling on Allah and responding in faith. |
| [2:201-202](https://quran.com/2/201-202) | dua | The prayer occurs after pilgrimage remembrance and contrasts with a request limited to worldly benefit; its balance and link to earned conduct are preserved. |
| [2:238-239](https://quran.com/2/238-239) | prayer | The verses explicitly cover prayer during fear and after safety, so the concession is retained; it is a practical salah passage rather than a general instruction to abandon form. |
| [2:263](https://quran.com/2/263) | good-deeds | The verse sits inside the almsgiving guidance of Al-Baqara; it qualifies charitable action by requiring humane speech and freedom from reproach. |
| [2:269](https://quran.com/2/269) | good-deeds | This follows the charity discussion and contrasts thoughtful sincerity with show; it is an encouragement to discernment, not a promise of status or wealth. |
| [2:277](https://quran.com/2/277) | prayer | The verse follows warnings about usury and debt, presenting a constructive pattern of faith, salah, and social obligation; its assurance is framed for that believing conduct. |
| [2:280](https://quran.com/2/280) | good-deeds | This is a specific debt ethic in the surrounding financial guidance; it is selected as practical mercy and must not be generalized into ignoring every contractual obligation. |
| [2:285-286](https://quran.com/2/285-286) | dua | The closing prayer of Al-Baqara joins creed, surrender, personal accountability, and repeated supplication; the final request for victory is retained as part of the original prayer, not recast as a universal worldly promise. |
| [3:8](https://quran.com/3/8) | dua | This prayer is voiced by people who affirm the whole revelation in the surrounding passage; it asks for continued steadiness rather than claiming that guidance makes later struggle impossible. |
| [3:16-17](https://quran.com/3/16-17) | dua | The verses describe people seeking the better life beyond worldly attractions; the dawn practice is stated as a quality of the righteous, with no invented prayer formula. |
| [3:38](https://quran.com/3/38) | dua | The speaker is Zachariah, praying after witnessing Mary’s provision in the sanctuary; the card preserves his prophetic and family-specific setting rather than presenting the outcome as guaranteed for every request. |
| [3:41](https://quran.com/3/41) | remembrance | The immediate speaker is the angel addressing Zachariah; the daily morning/evening rhythm is retained as the devotional feature, without treating the preceding sign as a general request. |
| [3:92](https://quran.com/3/92) | good-deeds | This sits in the argument about sincere Abrahamic faith and charity; it motivates costly generosity and does not specify a required amount or guarantee material return. |
| [3:113-115](https://quran.com/3/113-115) | prayer | The passage explicitly says the People of the Scripture are not all alike and praises a steadfast community among them; that audience distinction is preserved. |
| [3:134-136](https://quran.com/3/134-136) | good-deeds | These verses follow a call to hasten toward forgiveness and paradise; the sequence preserves both interpersonal restraint and active repentance, without erasing the condition of not persisting in the wrong. |
| [3:190-191](https://quran.com/3/190-191) | remembrance | The passage connects reflection on natural signs to bodily states of remembrance; the closing plea is included as part of the believers’ words, not as a scientific claim. |
| [3:193-194](https://quran.com/3/193-194) | dua | This is the believers’ supplication after the reflection passage; the selected range ends before the following verse’s historical account of migration and fighting, keeping the prayer complete and context clear. |
| [4:28](https://quran.com/4/28) | steadfastness | The verse concludes a sequence of lawful and unlawful relationship guidance; its encouragement is a general theological principle, not permission to ignore the surrounding limits. |
| [4:36](https://quran.com/4/36) | good-deeds | This is a broad social ethic following the command against associating partners with Allah; the historical wording about people in one’s care is summarized without extending its legal details. |
| [4:103](https://quran.com/4/103) | prayer | The verse follows the prayer of fear and therefore explicitly distinguishes the safety concession from regular appointed salah; both the remembrance and fixed-time obligation are retained. |
| [4:110](https://quran.com/4/110) | dua | The surrounding passage deals with wrongdoing, blame, and seeking pardon; the verse requires turning back after the wrong and does not promise immunity from consequences to others. |
| [4:114](https://quran.com/4/114) | good-deeds | The verse follows warnings about treachery and false advocacy, so its positive exception is deliberately narrow: private counsel should serve giving, good conduct, or peacemaking. |
| [4:135](https://quran.com/4/135) | good-deeds | This is a direct community command in the social-law section; the equal concern for rich and poor and the warning against bias are essential conditions of the guidance. |
| [4:149](https://quran.com/4/149) | good-deeds | The verse follows the allowance for a wronged person to speak harshly and therefore presents forgiveness and good action as deliberate alternatives, not as a command to suppress legitimate justice. |
| [4:162](https://quran.com/4/162) | prayer | The verse explicitly discusses knowledgeable People of the Scripture alongside believers; its praise of diligent prayer and giving is retained without erasing that audience context. |
| [5:2](https://quran.com/5/2) | good-deeds | The verse is situated in pilgrimage and post-conflict conduct; the positive principle is selected with the historical provocation and the prohibition on retaliation-driven injustice preserved. |
| [5:6](https://quran.com/5/6) | prayer | This is the core ablution and dry-purification verse; its concessions are conditions in the text and should not be collapsed into a blanket relaxation of prayer. |
| [5:8](https://quran.com/5/8) | good-deeds | The instruction appears among covenant and community obligations; its key guardrail is that emotional hostility cannot excuse unequal treatment. |
| [5:55](https://quran.com/5/55) | prayer | This is an in-group allegiance statement in the social and religious identity discussion; it is selected for its explicit salah and charity pattern, not as a license for hostility. |
| [5:74](https://quran.com/5/74) | dua | It follows a doctrinal correction concerning the Messiah and is addressed rhetorically to those who hold the mistaken claim; the invitation to repentance is retained without broadening the debate. |
| [5:100](https://quran.com/5/100) | good-deeds | The verse closes a sequence on lawful and unlawful choices; its contrast is moral discernment, not a financial or popularity forecast. |
| [6:17](https://quran.com/6/17) | steadfastness | The statement is part of a monotheistic argument against relying on rivals; it directs dependence to Allah and does not say that believers will avoid hardship. |
| [6:52](https://quran.com/6/52) | remembrance | The passage responds to pressure to exclude socially weaker believers; the morning/evening devotion and prohibition on contempt are central to its setting. |
| [6:54](https://quran.com/6/54) | good-deeds | This directly follows the instruction to welcome believers who come with revelation; forgiveness is conditioned on repentance and reform after the wrong. |
| [6:63-64](https://quran.com/6/63-64) | dua | The passage exposes the inconsistency of calling Allah in crisis and then associating partners after relief; the conditional rescue and required gratitude are both preserved. |
| [6:71-72](https://quran.com/6/71-72) | prayer | This answer addresses the image of a person bewildered by competing calls; prayer appears as part of surrender and duty, not as a standalone ritual detached from guidance. |
| [6:152-153](https://quran.com/6/152-153) | good-deeds | These verses summarize a sequence of sacred duties and explicitly state that no soul is burdened beyond its scope; the selected range preserves both practical ethics and the path metaphor. |
| [7:23](https://quran.com/7/23) | dua | The speakers are Adam and his wife after the Garden episode; the card presents their model of confession and appeal without erasing the narrative consequence of their error. |
| [7:29](https://quran.com/7/29) | prayer | The verse answers pagan claims that impropriety was divinely commanded; its prayer guidance is paired with justice and sincerity, not merely outward appearance. |
| [7:55-56](https://quran.com/7/55-56) | dua | The verses sit in the creation and prophetic-reminder section; the approach to dua includes humility, quietness, balanced fear and hope, and ethical restraint. |
| [7:155-156](https://quran.com/7/155-156) | dua | The speakers and setting are Moses and the seventy after a trembling at the appointed meeting; the broad mercy statement retains its stated conditions rather than becoming an unconditional promise. |
| [7:170](https://quran.com/7/170) | prayer | The verse refers to a community among the Children of Israel that maintains the Scripture; it is used as an exemplar and keeps that historical audience visible. |
| [7:199](https://quran.com/7/199) | good-deeds | This is a direct instruction to the Prophet in the closing ethical guidance of the surah; it is presented as a model of conduct, not a claim that every conflict should be ignored. |
| [7:200-201](https://quran.com/7/200-201) | remembrance | The first command addresses the messenger and the next verse describes the God-conscious generally; the sequence connects spiritual disturbance with a concrete return to remembrance. |
| [7:205](https://quran.com/7/205) | remembrance | This is a Prophet-directed devotional instruction; its quiet morning/evening remembrance is preserved as the motivation, without converting every detail into an asserted legal schedule. |
| [8:2-4](https://quran.com/8/2-4) | prayer | These are the opening believer qualities in a surah whose immediate subject is disputes over spoils; the card focuses on the devotional traits and keeps the surrounding community setting. |
| [8:24](https://quran.com/8/24) | good-deeds | The verse addresses the believing community amid obedience and conflict instructions; “gives life” is retained as spiritual and moral language rather than reduced to a worldly outcome. |
| [8:29](https://quran.com/8/29) | steadfastness | The verse is a direct conditional exhortation in the community-trust section; its benefits are discernment, forgiveness, and removal of wrong, not material success. |
| [8:61](https://quran.com/8/61) | steadfastness | This guidance is explicitly situated in treaty and conflict management; the positive principle is a conditional preference for peace with reliance on Allah, not a general foreign-policy rule detached from context. |
| [9:18](https://quran.com/9/18) | prayer | The verse addresses who should maintain the sanctuaries in a dispute over pilgrimage and belief; its explicit salah and charity pattern is retained with that sanctuary context. |
| [9:51](https://quran.com/9/51) | steadfastness | This reassurance occurs amid campaign reactions and claims about calamity; it concerns reliance under uncertainty and does not deny human responsibility or grief. |
| [9:71](https://quran.com/9/71) | prayer | The verse gives a community-wide description including both men and women; prayer is one part of a wider pattern of mutual care, ethical action, and obedience. |
| [9:102-104](https://quran.com/9/102-104) | good-deeds | These verses concern people who remained behind and admitted faults in the expedition context; repentance, corrective action, and charity are preserved without promising automatic absolution. |
| [9:108](https://quran.com/9/108) | prayer | The verse specifically contrasts a sound mosque with a rival place of worship established for dissent; its praise of prayer and purification should not be detached from that historical contrast. |
| [9:112](https://quran.com/9/112) | prayer | This is a compact catalogue of believer qualities after the discussion of sincere commitment; prostration is preserved among a wider set of practices and ethical duties. |
| [9:117-118](https://quran.com/9/117-118) | steadfastness | The historical setting is the hardship of an expedition and the repentance of specific companions; the card keeps the named groups and the sequence of distress, turning, and repentance. |
| [9:119](https://quran.com/9/119) | good-deeds | This short community command follows the repentance and mercy account; truthfulness is presented as a practical companion to duty, not as a claim of moral perfection. |
| [9:129](https://quran.com/9/129) | steadfastness | This is a Prophet-directed closing response to rejection; it is a model of reliance under refusal, not a guarantee that every desired outcome will follow. |
| [10:22](https://quran.com/10/22) | dua | A narrative warning: the next verse says they later rebel after rescue, so the encouragement is to keep sincerity beyond crisis. |
| [10:57-58](https://quran.com/10/57-58) | remembrance | The passage addresses humankind and believers; 'healing' is kept in the text's spiritual wording, without turning it into a medical claim. |
| [10:62-64](https://quran.com/10/62-64) | steadfastness | The reassurance is explicitly conditioned on belief and God-conscious conduct and includes both worldly life and the Hereafter. |
| [10:87](https://quran.com/10/87) | prayer | This is an instruction to Moses and Aaron for their people in Egypt; it supports a worship-centered home without treating the historical setting as a universal building rule. |
| [11:3](https://quran.com/11/3) | dua | It includes a time-bound worldly enjoyment and a warning for turning away; the card does not turn that wording into a prosperity guarantee. |
| [11:11](https://quran.com/11/11) | steadfastness | The encouragement is conditional on both patience and good works. |
| [11:47](https://quran.com/11/47) | dua | This is a prophet's prayer after a specific family matter; the transferable practice is humility before divine knowledge. |
| [11:114-115](https://quran.com/11/114-115) | prayer | The wording addresses Muhammad within a prophetic passage; it offers prayer and patience as a pattern, while the exact schedule is not reinterpreted here. |
| [12:18](https://quran.com/12/18) | steadfastness | The verse belongs to Jacob's response to his sons' false account of Joseph; patience here does not deny grief or facts. |
| [12:33-34](https://quran.com/12/33-34) | dua | This is Joseph's prayer in a coercive setting and the text's reported response; it is not a promise that every difficult outcome will be immediate. |
| [12:83-87](https://quran.com/12/83-87) | steadfastness | The range preserves Jacob's grief, his private complaint to Allah, and his call to action; hope is paired with effort, not passive optimism. |
| [13:22-24](https://quran.com/13/22-24) | prayer | These are presented as qualities of those seeking their Lord's countenance, with the promised sequel tied to the full set of qualities. |
| [13:28](https://quran.com/13/28) | remembrance | The verse states a spiritual relationship in concise form; it does not prescribe a particular quantity or technique of remembrance. |
| [14:24-25](https://quran.com/14/24-25) | good-deeds | This is a parable; the card keeps the source's dependence on Allah's permission rather than turning it into a worldly success formula. |
| [14:31](https://quran.com/14/31) | prayer | The command is addressed to believing servants and joins worship with generosity; it is not a promise of financial return. |
| [14:37-41](https://quran.com/14/37-41) | dua | These are Abraham's supplications concerning his descendants near the Sacred House; the family and location details remain part of the narrative. |
| [15:55-56](https://quran.com/15/55-56) | steadfastness | The exchange concerns Abraham's visitors and a promised son; the card presents the anti-despair principle without claiming a specific worldly outcome for readers. |
| [15:98-99](https://quran.com/15/98-99) | prayer | The commands are addressed to Muhammad; the phrase until the Inevitable is kept as an exceptional prophetic scope, not recast as a universal timetable. |
| [16:18](https://quran.com/16/18) | remembrance | It follows a passage listing signs and provisions; the encouragement is grateful attention rather than a material entitlement. |
| [16:90](https://quran.com/16/90) | good-deeds | This is a general ethical exhortation; it is selected for practical conduct rather than legal detail. |
| [16:96-97](https://quran.com/16/96-97) | good-deeds | The passage explicitly conditions its encouragement on faith, right action, and steadfastness; 'good life' is left at the Qur'an's broad wording. |
| [16:119](https://quran.com/16/119) | good-deeds | Ignorance, repentance, and amendment are all part of the stated condition; the verse does not erase the need to repair harm. |
| [17:23-25](https://quran.com/17/23-25) | dua | The duty is stated as worship plus filial kindness; the prayer preserves the parent-care context and does not excuse injustice or coercion. |
| [17:26-29](https://quran.com/17/26-29) | good-deeds | It is a practical stewardship passage; the surrounding provision verse is not used to promise equal material outcomes. |
| [17:53](https://quran.com/17/53) | good-deeds | The wording is a general instruction to the believers' community; it is selected as interpersonal practice. |
| [17:78](https://quran.com/17/78) | prayer | The imperative is addressed to Muhammad in context; this card highlights the prayer-and-recitation rhythm without adding a legal timetable. |
| [17:79](https://quran.com/17/79) | prayer | This is an exceptional, prophet-specific night-prayer instruction (nafilatan laka); it must not be presented as a universal extra duty. |
| [18:10](https://quran.com/18/10) | dua | The prayer belongs to a narrative of young believers seeking refuge; it models asking for both mercy and sound action. |
| [18:23-24](https://quran.com/18/23-24) | remembrance | The immediate context corrects overconfident speech about future action; it supports humility and recovery rather than fatalism. |
| [18:28](https://quran.com/18/28) | remembrance | It is addressed to Muhammad and contrasts sincere remembrance with heedlessness and desire; the social lesson is to value devotional company. |
| [19:3-6](https://quran.com/19/3-6) | dua | This is a prophet's intimate supplication; it shows candour and hope while preserving his specific family request. |
| [19:12-14](https://quran.com/19/12-14) | good-deeds | These qualities are presented in a prophetic character portrait; the card treats them as virtues to cultivate, not a claim of prophetic status. |
| [19:31-32](https://quran.com/19/31-32) | prayer | These are Jesus' words in the narrative; the card extracts enduring prayer, generosity, filial duty, and humility without claiming readers are prophets. |
| [19:55](https://quran.com/19/55) | prayer | The preceding verse identifies Ishmael as a messenger and prophet; this card preserves that prophetic setting while highlighting worship and almsgiving. |
| [19:58](https://quran.com/19/58) | prayer | The verse describes prophets and chosen servants in a narrative catalogue; it is an image of reverent response, not a command to manufacture emotion. |
| [20:14](https://quran.com/20/14) | prayer | The command is spoken to Moses, while the explicit link between salah and remembrance provides the selected daily principle. |
| [20:25-28](https://quran.com/20/25-28) | dua | This is Moses' supplication before Pharaoh; it models seeking inward steadiness and communicative clarity before action. |
| [20:82](https://quran.com/20/82) | good-deeds | Forgiveness is tied to a sequence of repentance, faith, good action, and continued right direction; no shortcut is implied. |
| [20:114](https://quran.com/20/114) | dua | The surrounding instruction addresses Muhammad's reception of revelation; the short prayer is presented as a model for learning, without claiming instant expertise. |
| [20:132](https://quran.com/20/132) | prayer | This is a prophet-specific instruction about his people and household responsibility; the provision wording is not turned into a prosperity claim. |
| [21:73](https://quran.com/21/73) | prayer | The subject is a group of prophets, so the leadership description is an exemplar rather than a universal office or personal promise. |
| [21:83-84](https://quran.com/21/83-84) | dua | This is Job's narrative and a divine response; it is encouragement to supplicate, not a guaranteed timetable for relief. |
| [21:87-88](https://quran.com/21/87-88) | dua | The scene is a prophetic narrative; the selected words preserve confession, glorification, and appeal rather than reducing it to a formula. |
| [21:89-90](https://quran.com/21/89-90) | dua | The requested child belongs to Zachariah's story; the transferable pattern is hopeful, reverent prayer joined to good action. |
| [21:94](https://quran.com/21/94) | good-deeds | The statement is conditioned on belief and good action; it encourages consistent effort without specifying worldly results. |
| [22:34-35](https://quran.com/22/34-35) | prayer | The setting includes sacrificial ritual and an address to Muhammad; this card selects the qualities of humility, patience, prayer, and generosity without extending ritual particulars. |
| [22:77-78](https://quran.com/22/77-78) | prayer | This is a direct believer address with pilgrimage-era language and a witness role; it is used for its worship-and-goodness pattern, not as a legal summary. |
| [23:1-2](https://quran.com/23/1-2) | prayer | Later verses add avoiding vain talk, almsgiving, modesty, faithful pledges, and attentive prayers before describing Paradise's heirs; this narrow card preserves the opening quality without collapsing the full portrait. |
| [23:57-62](https://quran.com/23/57-62) | good-deeds | The capacity statement sits alongside accountability and truthful record keeping; it is encouragement toward sincere effort, not permission to neglect obligations. |
| [23:97-98](https://quran.com/23/97-98) | dua | It is a direct prayer in a passage that also teaches repelling evil with what is better; the card presents refuge as a spiritual practice. |
| [24:22](https://quran.com/24/22) | good-deeds | The instruction follows a slander episode and is directed to people able to give; it links generosity and pardon without erasing the surrounding harm. |
| [24:36-38](https://quran.com/24/36-38) | prayer | The range intentionally starts at 24:36 and omits the preceding Light parable; reward remains tied to remembrance, prayer, and giving. |
| [24:56](https://quran.com/24/56) | prayer | This is a direct believer address in the Medinan social passage; the card keeps obedience to the messenger explicit and avoids expanding it into legal detail. |
| [25:62](https://quran.com/25/62) | remembrance | This is a general invitation to use recurring time as a devotional cue, without prescribing a specific ritual. |
| [25:63-67](https://quran.com/25/63-67) | prayer | The range is a character portrait of the Beneficent's servants; it includes a prayer against hell, while the card foregrounds humility, night worship, and balanced giving. |
| [25:70-71](https://quran.com/25/70-71) | good-deeds | The transformation is stated with explicit conditions and follows grave wrongdoing; it is not a license to repeat harm. |
| [25:74](https://quran.com/25/74) | dua | This is a prayer of the faithful servants; it asks for family well-being together with responsibility to model good conduct. |
| [26:83-89](https://quran.com/26/83-89) | dua | These are Abraham's prayers and his statement about the Day of Resurrection; the card preserves the hereafter-focused frame and avoids promising reputation or status. |
| [27:19](https://quran.com/27/19) | dua | The speaker is Solomon in a narrative scene; the transferable practice is to convert power or success into gratitude and service. |
| [27:62](https://quran.com/27/62) | dua | It is a rhetorical monotheistic argument, not a timetable for every distress; the encouragement is to direct urgent appeal to Allah. |
| [27:89](https://quran.com/27/89) | good-deeds | The statement concerns the Hereafter and is explicitly conditional on bringing a good deed; it is not a worldly reward calculation. |
| [28:16](https://quran.com/28/16) | dua | This follows a specific accidental killing in Moses' story; the card emphasizes accountability and repentance, not the narrative circumstance. |
| [28:21-24](https://quran.com/28/21-24) | dua | The range deliberately retains both supplication and service; it is a narrative of displacement, so it does not promise that every request leads to the same outcome. |
| [28:77](https://quran.com/28/77) | good-deeds | This counsel appears in the story of Korah's wealth; it rejects both worldly arrogance and neglect of legitimate worldly responsibilities. |
| [29:45](https://quran.com/29/45) | prayer | It is a direct worship instruction followed by a dialogue ethic; the card preserves prayer's moral purpose and the primacy of remembrance. |
| [29:69](https://quran.com/29/69) | steadfastness | The statement concerns striving in Allah's cause and goodness; it is encouragement for sustained effort, not a promise that every chosen plan is divinely endorsed. |
| [30:17-18](https://quran.com/30/17-18) | remembrance | The commands occur in a passage addressed to Muhammad; the card presents the recurring remembrance rhythm without adding a fixed liturgical schedule. |
| [30:30-31](https://quran.com/30/30-31) | prayer | The imperative is addressed to Muhammad in context; the selected principle is return, devotion, and prayer rather than a claim about human psychology. |
| [30:38](https://quran.com/30/38) | good-deeds | It is a practical charity instruction; the card preserves the spiritual motive without making a financial-growth claim. |
| [31:2-5](https://quran.com/31/2-5) | prayer | The description is conditional on the full set of practices; the card does not reduce success to a single ritual. |
| [31:17](https://quran.com/31/17) | prayer | This is parental counsel within Luqman's teaching; it presents worship, ethical action, and patience as a connected discipline. |
| [32:15-17](https://quran.com/32/15-17) | prayer | The passage describes believers' response and its reward; the card preserves fear-and-hope balance and does not turn hidden joy into a worldly guarantee. |
| [33:3](https://quran.com/33/3) | steadfastness | Directly addressed to Muhammad; included as a model of reliance, not a universal command assigned to every reader. |
| [33:41-43](https://quran.com/33/41-43) | remembrance | A direct address to believers; morning and evening appear with abundant remembrance, without prescribing a specific ritual form. |
| [33:70-71](https://quran.com/33/70-71) | steadfastness | A direct universal address; the benefit is tied to duty, truthful speech, and obedience. |
| [35:10](https://quran.com/35/10) | good-deeds | The pairing of wholesome speech and righteous action is retained without settling different translation choices about what is raised; no worldly status or wealth is promised. |
| [35:29-30](https://quran.com/35/29-30) | prayer | A general description of people who engage Scripture, worship, and generosity; the promise is the passage's enduring spiritual reward, not a worldly profit claim. |
| [37:99-100](https://quran.com/37/99-100) | dua | Abraham's narrative before the later trial; the Arabic request is for a gift from among the righteous, and the following verses announce a gentle son. |
| [38:29](https://quran.com/38/29) | remembrance | A general purpose statement about revelation; it encourages reflection rather than a specific interpretive method. |
| [38:41-43](https://quran.com/38/41-43) | dua | A prophetic narrative; the range stops before 38:44, so its unusual oath-breaking remedy is not included. |
| [39:9](https://quran.com/39/9) | prayer | A rhetorical question to Muhammad about night devotion and knowledge; the Arabic describes a devout person standing and prostrating, while Pickthall says adoration. |
| [39:10](https://quran.com/39/10) | steadfastness | Addressed to believing servants; 'spacious earth' is part of the passage's encouragement, not a promise of wealth. |
| [39:22-23](https://quran.com/39/22-23) | remembrance | A description of inner response to revelation; warning language remains in the surrounding context, while the card focuses on softening. |
| [39:38](https://quran.com/39/38) | steadfastness | A response to claims about rival protectors; mercy and harm are framed as divine power, not a guarantee of a painless life. |
| [39:46](https://quran.com/39/46) | dua | A command to Muhammad to say this in response to theological dispute; it is a supplication about ultimate judgment, not a promise of immediate resolution. |
| [39:53-55](https://quran.com/39/53-55) | steadfastness | The invitation includes repentance and action; it does not erase the passage's call to return and follow guidance. |
| [40:7-9](https://quran.com/40/7-9) | dua | The angels' intercession is conditional on repentance and following the path; family inclusion is qualified by doing right. |
| [40:14](https://quran.com/40/14) | dua | An imperative to believers in a polemical passage; it presents steadfast devotion, not a promise of a particular worldly result. |
| [40:60](https://quran.com/40/60) | dua | A general divine address. Pickthall translates the response as hearing the prayer, while the Arabic uses a verb of response; the surrounding warning is not used as the card's motivation. |
| [40:65](https://quran.com/40/65) | dua | A general monotheistic invitation; praise and supplication are joined in the same verse. |
| [41:33](https://quran.com/41/33) | good-deeds | The Arabic phrase calls toward Allah; Pickthall's 'prayeth' is read alongside the Arabic so the card does not reduce it to ritual prayer. |
| [41:34-35](https://quran.com/41/34-35) | steadfastness | General ethical guidance; reconciliation is presented as possible, not certain in every relationship. |
| [41:46](https://quran.com/41/46) | good-deeds | Moral accountability is attributed to the actor; the verse does not promise an immediate worldly result. |
| [42:38](https://quran.com/42/38) | prayer | A description of believers in a passage contrasting lasting divine gifts with worldly comfort; prayer is one part of a shared ethical life. |
| [42:40-43](https://quran.com/42/40-43) | steadfastness | The full range preserves limits: pardon and reform are praised, oppression is condemned, and redress after wrong is acknowledged. |
| [46:13-14](https://quran.com/46/13-14) | steadfastness | The assurance is tied to upright faith and the Hereafter; it does not claim believers never feel fear or grief in worldly life. |
| [46:15-16](https://quran.com/46/15-16) | dua | A universal moral exhortation framed at maturity, with the prayer spoken by the person; acceptance is described in the following verse. |
| [49:6](https://quran.com/49/6) | good-deeds | A direct community instruction about unreliable reports; verification is the condition before action. |
| [49:10](https://quran.com/49/10) | good-deeds | A universal community instruction; selected alone to keep the focus on reconciliation and mercy rather than the combat procedure in the preceding verse. |
| [49:11-13](https://quran.com/49/11-13) | good-deeds | Universal addresses to believers and mankind; the range preserves repentance and mercy after the prohibitions. |
| [50:39-40](https://quran.com/50/39-40) | prayer | Directly addressed to Muhammad; the devotional rhythm is preserved as a prophetic model and is not turned into a universal schedule. |
| [51:15-19](https://quran.com/51/15-19) | remembrance | A descriptive portrait of the God-conscious, not a fixed minimum night schedule or a prosperity formula. |
| [51:50-51](https://quran.com/51/50-51) | remembrance | An urgent monotheistic summons in a warning section; 'flee' is spiritual return, not a physical flight instruction. |
| [51:56-58](https://quran.com/51/56-58) | remembrance | A general theological statement; worship is broader than ritual prayer, and the provision language is not presented as a prosperity promise. |
| [53:31-32](https://quran.com/53/31-32) | good-deeds | Pickthall renders the Arabic exception al-lamam as 'unwilled offences'; this review does not equate all minor offences with involuntary acts. The warning against self-righteousness is retained. |
| [53:39](https://quran.com/53/39) | steadfastness | Part of a passage affirming that effort will be seen and fully repaid; this card preserves the concise original line without extending it to a worldly success guarantee. |
| [54:10](https://quran.com/54/10) | dua | Noah's prayer within a rejection narrative; it records a plea in crisis rather than a guarantee that every requested outcome arrives immediately. |
| [54:17](https://quran.com/54/17) | remembrance | A repeated refrain within the warning narratives; selected once, without treating the repeated refrain as multiple unique cards. |
| [57:7](https://quran.com/57/7) | good-deeds | The verse frames possessions as entrusted, so generosity is a responsibility; it does not promise a particular financial return. |
| [57:16](https://quran.com/57/16) | remembrance | A direct address warning against prolonged heedlessness; it calls for renewed receptivity, not despair. |
| [57:21-23](https://quran.com/57/21-23) | steadfastness | The range links aspiration with emotional balance; it does not deny grief or forbid gratitude, but cautions against despair and pride. |
| [58:1](https://quran.com/58/1) | dua | A specific marital dispute involving a woman and Muhammad; the general encouragement is Allah's hearing of sincere complaint, while legal details continue beyond this verse. |
| [59:8-9](https://quran.com/59/8-9) | good-deeds | Historical portraits of early emigrants and helpers; the ethical focus is solidarity and freedom from avarice. |
| [59:10](https://quran.com/59/10) | dua | A community supplication in the context of early emigrants and helpers; it is a model for shared remembrance and reconciliation. |
| [60:5](https://quran.com/60/5) | dua | An Abrahamic example in a passage about religious loyalty; the historical setting and speaker are explicit. |
| [60:8](https://quran.com/60/8) | good-deeds | The condition is explicit: peaceful noncombatants are distinguished from those who waged war or expelled people; avoid generalizing beyond that condition. |
| [62:9-10](https://quran.com/62/9-10) | prayer | A direct address to believers about the Friday congregational call. The passage joins attending prayer with renewed remembrance afterward. |
| [64:11](https://quran.com/64/11) | steadfastness | A theological statement about hardship and inward guidance; it does not say every event is punishment or remove the need for practical care. |
| [66:8](https://quran.com/66/8) | dua | A collective eschatological scene; repentance and the prayer are addressed to believers, with no claim that perfection is automatic without turning back. |
| [66:11](https://quran.com/66/11) | dua | A named example of faith under oppression; this is her supplication, not a universal worldly housing promise. |
| [69:52](https://quran.com/69/52) | remembrance | A concluding instruction in a surah focused on the Reality and accountability; devotional response follows the warning. |
| [70:22-23](https://quran.com/70/22-23) | prayer | A general description of worshippers; the range is narrowed to the explicit prayer statement so the later sexual and legal material is not included. |
| [72:18](https://quran.com/72/18) | prayer | A statement in the jinn chapter about monotheistic worship; it contains no separate legal detail beyond directing supplication to Allah. |
| [73:6](https://quran.com/73/6) | prayer | The verse follows direct commands to Muhammad about night vigil and measured recitation; it explains the practice's quality rather than setting a universal duration. |
| [73:8](https://quran.com/73/8) | remembrance | A direct instruction to Muhammad in the opening night-vigil passage; it is preserved as a prophetic devotional model. |
| [73:20](https://quran.com/73/20) | prayer | Addressed first to Muhammad and his companions, it includes illness and travel and does not impose a universal night quota; the selected verse also mentions fighting in its historical setting. |
| [76:7-12](https://quran.com/76/7-12) | good-deeds | The motivation is sincere giving; the promised outcome is the passage's eschatological description, not a worldly transaction. |
| [76:25-26](https://quran.com/76/25-26) | remembrance | Directly addressed to Muhammad; the passage is a devotional model and does not impose a universal night quota. |
| [79:40-41](https://quran.com/79/40-41) | steadfastness | A general moral contrast within the account of Moses and Pharaoh; it presents self-restraint as an enduring practice. |
| [87:14-15](https://quran.com/87/14-15) | prayer | A concise general maxim near the end of a reminder; it connects spiritual growth, remembrance, and prayer without adding a particular ritual form. |
| [89:27-30](https://quran.com/89/27-30) | steadfastness | An eschatological address to the soul at the end of a warning against greed and neglect of the vulnerable; it is not a worldly mental-health guarantee. |
| [90:11-18](https://quran.com/90/11-18) | good-deeds | The passage gives concrete social actions and communal virtues; its opening critique of failing the ascent is retained. |
| [94:5-8](https://quran.com/94/5-8) | steadfastness | Directly addressed to Muhammad; the repeated statement and following instruction form an encouragement, not a promise of a specific timetable. |
| [96:19](https://quran.com/96/19) | prayer | A closing instruction addressed to Muhammad amid confrontation with someone who tries to stop a servant's prayer; it is kept as devotional encouragement, not a separate legal ruling. |
| [97:1-5](https://quran.com/97/1-5) | remembrance | The text describes the night and its peace; it does not specify a particular prayer or guarantee a personal outcome. |
| [98:5](https://quran.com/98/5) | prayer | A universal order in a passage about clear proof; worship, prayer, and the poor-due are presented together as the sound religious practice. |
| [103:1-3](https://quran.com/103/1-3) | steadfastness | The complete three-verse thought is retained: the opening oath and loss diagnosis frame the communal conditions in the final verse. |
| [108:2](https://quran.com/108/2) | prayer | A direct address to Muhammad in a very short surah; the preceding verse supplies the context of a gift, while this card preserves the prayer and sacrifice instruction without generalizing its speaker. |
| [112:1-4](https://quran.com/112/1-4) | remembrance | A concise declaration of divine oneness for recitation and reflection; no narrative speaker is implied beyond the commanded declaration. |
| [113:1-5](https://quran.com/113/1-5) | dua | A direct refuge prayer; it names feared harms rather than promising their absence. |
| [114:1-6](https://quran.com/114/1-6) | dua | A direct refuge prayer; the text identifies the source of whispering without assigning every distress to it. |
