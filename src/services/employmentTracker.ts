import type {
  EmploymentApplication,
  EmploymentApplicationStatus,
  EmploymentHistoryEntry,
  EmploymentRemoteRegion,
  EmploymentRemoteStatus,
  EmploymentTrackerState,
  EmploymentWorkType,
} from '../types/domain';

export const EMPLOYMENT_SEED_VERSION = 1;
export const EMPLOYMENT_ACTIVE_STATUSES: EmploymentApplicationStatus[] = [
  'lead',
  'recruiter',
  'applied',
  'interview',
  'offer',
];

export interface EmploymentApplicationDraft {
  company: string;
  role: string;
  url?: string;
  workType: EmploymentWorkType;
  remoteRegion: EmploymentRemoteRegion;
  remoteStatus: EmploymentRemoteStatus;
  remoteEvidence: string;
  remoteCaveat?: string;
  compensation?: string;
  status: EmploymentApplicationStatus;
  applicationDate?: string;
  nextAction: string;
  nextActionDate?: string;
  notes: string;
  history: EmploymentHistoryEntry[];
}

export interface EmploymentFilters {
  query: string;
  status: EmploymentApplicationStatus | 'all';
  workType: EmploymentWorkType | 'all';
  remoteStatus: EmploymentRemoteStatus | 'all';
}

export interface EmploymentActivityEntry {
  id: string;
  applicationId: string;
  company: string;
  role: string;
  date?: string;
  summary: string;
  details: string;
  kind: 'application' | EmploymentHistoryEntry['kind'];
}

const SEEDED_APPLICATIONS: EmploymentApplication[] = [
  {
    id: 'employment-grafana-staff-ai-engineer',
    company: 'Grafana Labs',
    role: 'Staff AI Engineer, 2nd Horizon, UK Remote',
    workType: 'unknown',
    remoteRegion: 'uk',
    remoteStatus: 'needs_verification',
    remoteEvidence: 'The advert describes the role as 100% remote in the UK.',
    remoteCaveat: 'The advert also mentions in-person onboarding. Confirm the onboarding expectation before progressing.',
    status: 'applied',
    applicationDate: '2026-08-29',
    nextAction: 'Verify that onboarding does not change the fully remote arrangement.',
    notes: 'Application submitted and receipt verified.',
    history: [
      {
        id: 'employment-grafana-receipt-2026-08-29',
        kind: 'application',
        date: '2026-08-29',
        summary: 'Application receipt verified',
        details: 'The Staff AI Engineer application was submitted and the receipt was verified.',
      },
      {
        id: 'employment-grafana-remote-advert',
        kind: 'remote_evidence',
        summary: 'Remote advert needs caveat check',
        details: 'The advert says 100% remote but also mentions in-person onboarding.',
      },
    ],
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  },
  {
    id: 'employment-opentrade-fintech-web3',
    company: 'OpenTrade',
    role: 'Fullstack / Backend — fintech / Web3',
    workType: 'unknown',
    remoteRegion: 'unknown',
    remoteStatus: 'needs_verification',
    remoteEvidence: 'Fully remote eligibility and UK/EMEA/global coverage have not yet been recorded.',
    compensation: '$160k–$200k plus equity',
    status: 'recruiter',
    nextAction: 'Await the recruiter introduction and verify remote eligibility.',
    notes: 'Corrected CV and screening details sent. Recruiter introduction pending.',
    history: [
      {
        id: 'employment-opentrade-cv-screening',
        kind: 'document',
        summary: 'Corrected CV and screening details sent',
        details: 'Recruiter introduction remains pending. No event date was supplied.',
      },
    ],
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  },
  {
    id: 'employment-chainalysis-protocols',
    company: 'Chainalysis',
    role: 'Senior Software Engineer, Protocols',
    workType: 'unknown',
    remoteRegion: 'unknown',
    remoteStatus: 'needs_verification',
    remoteEvidence: 'Fully remote eligibility and UK/EMEA/global coverage have not yet been recorded.',
    status: 'recruiter',
    nextAction: 'Follow up with the recruiter and verify remote eligibility.',
    notes: 'Recruiter put-forward authorised. Corrected CV sent. Recruiter follow-up pending.',
    history: [
      {
        id: 'employment-chainalysis-put-forward',
        kind: 'contact',
        summary: 'Recruiter put-forward authorised',
        details: 'Corrected CV sent; recruiter follow-up remains pending. No event date was supplied.',
      },
    ],
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  },
];

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function validOptionalUrl(value: string | undefined, label: string): string | undefined {
  const trimmed = optionalText(value);
  if (!trimmed) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a valid web URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use http or https.`);
  }
  return url.toString();
}

export function createDefaultEmploymentTrackerState(): EmploymentTrackerState {
  return {
    seedVersion: EMPLOYMENT_SEED_VERSION,
    applications: SEEDED_APPLICATIONS.map(application => ({
      ...application,
      history: application.history.map(entry => ({ ...entry })),
    })),
  };
}

export function normalizeEmploymentApplicationDraft(
  draft: EmploymentApplicationDraft,
): EmploymentApplicationDraft {
  const company = draft.company.trim();
  const role = draft.role.trim();
  const remoteEvidence = draft.remoteEvidence.trim();
  const nextAction = draft.nextAction.trim();
  if (!company) throw new Error('Company is required.');
  if (!role) throw new Error('Role is required.');
  if (!remoteEvidence) throw new Error('Record the fully remote evidence or what still needs verification.');
  if (!nextAction) throw new Error('Next action is required.');
  if (draft.remoteStatus === 'confirmed' && draft.remoteRegion === 'unknown') {
    throw new Error('Confirmed remote roles must record UK, EMEA, or global eligibility.');
  }

  return {
    company,
    role,
    url: validOptionalUrl(draft.url, 'Role URL'),
    workType: draft.workType,
    remoteRegion: draft.remoteRegion,
    remoteStatus: draft.remoteStatus,
    remoteEvidence,
    remoteCaveat: optionalText(draft.remoteCaveat),
    compensation: optionalText(draft.compensation),
    status: draft.status,
    applicationDate: optionalText(draft.applicationDate),
    nextAction,
    nextActionDate: optionalText(draft.nextActionDate),
    notes: draft.notes.trim(),
    history: draft.history.map(entry => ({
      ...entry,
      summary: entry.summary.trim(),
      details: entry.details.trim(),
      date: optionalText(entry.date),
      evidenceUrl: validOptionalUrl(entry.evidenceUrl, 'Evidence URL'),
    })),
  };
}

export function matchesEmploymentFilters(
  application: EmploymentApplication,
  filters: EmploymentFilters,
): boolean {
  const query = filters.query.trim().toLocaleLowerCase();
  if (filters.status !== 'all' && application.status !== filters.status) return false;
  if (filters.workType !== 'all' && application.workType !== filters.workType) return false;
  if (filters.remoteStatus !== 'all' && application.remoteStatus !== filters.remoteStatus) return false;
  if (!query) return true;

  const haystack = [
    application.company,
    application.role,
    application.compensation,
    application.nextAction,
    application.notes,
    application.remoteEvidence,
    application.remoteCaveat,
  ].filter(Boolean).join(' ').toLocaleLowerCase();
  return haystack.includes(query);
}

export function getEmploymentActivity(
  applications: EmploymentApplication[],
): EmploymentActivityEntry[] {
  return applications.flatMap(application => {
    const entries: EmploymentActivityEntry[] = application.history.map(entry => ({
      id: entry.id,
      applicationId: application.id,
      company: application.company,
      role: application.role,
      date: entry.date,
      summary: entry.summary,
      details: entry.details,
      kind: entry.kind,
    }));
    const submissionAlreadyRecorded = application.applicationDate
      && application.history.some(entry => (
        entry.kind === 'application' && entry.date === application.applicationDate
      ));
    if (application.applicationDate && !submissionAlreadyRecorded) {
      entries.push({
        id: `${application.id}:submitted`,
        applicationId: application.id,
        company: application.company,
        role: application.role,
        date: application.applicationDate,
        summary: 'Application submitted',
        details: application.role,
        kind: 'application',
      });
    }
    return entries;
  }).sort((left, right) => {
    if (left.date && right.date && left.date !== right.date) return right.date.localeCompare(left.date);
    if (left.date && !right.date) return -1;
    if (!left.date && right.date) return 1;
    return left.company.localeCompare(right.company) || left.summary.localeCompare(right.summary);
  });
}

export function getEmploymentSummary(applications: EmploymentApplication[], today: string) {
  const activity = getEmploymentActivity(applications);
  return {
    active: applications.filter(application => EMPLOYMENT_ACTIVE_STATUSES.includes(application.status)).length,
    recruiter: applications.filter(application => application.status === 'recruiter').length,
    applied: applications.filter(application => application.status === 'applied').length,
    needsRemoteVerification: applications.filter(application => application.remoteStatus === 'needs_verification').length,
    activityToday: activity.filter(entry => entry.date === today).length,
  };
}
