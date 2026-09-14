import type {
  EmploymentApplication,
  EmploymentApplicationStatus,
  EmploymentTrackerState,
} from '../../src/types/domain';

interface ScenarioApplication {
  id: string;
  company: string;
  role: string;
  status: EmploymentApplicationStatus;
  applicationDate?: string;
  historyDate?: string;
  nextAction: string;
  createdAt?: string;
}

function application({
  id,
  company,
  role,
  status,
  applicationDate,
  historyDate,
  nextAction,
  createdAt = '2026-08-01T09:00:00.000Z',
}: ScenarioApplication): EmploymentApplication {
  return {
    id,
    company,
    role,
    workType: id.includes('grafana') || id.includes('chainalysis') ? 'permanent' : 'contract',
    remoteRegion: id.includes('opentrade') ? 'emea' : 'uk',
    remoteStatus: id.includes('alignerr-secondary') ? 'needs_verification' : 'confirmed',
    remoteEvidence: 'The synthetic role brief confirms remote work for the recorded region.',
    status,
    applicationDate,
    nextAction,
    nextActionDate: status === 'closed' ? undefined : '2026-09-18',
    compensation: status === 'closed' ? undefined : 'Compensation to confirm at the next stage',
    notes: `Synthetic test record for ${role}.`,
    history: historyDate ? [{
      id: `${id}-history`,
      kind: 'contact',
      date: historyDate,
      summary: 'Latest confirmed pipeline update',
      details: 'Synthetic history used to verify date-based ordering.',
    }] : [],
    createdAt,
    updatedAt: createdAt,
  };
}

export function createRepresentativeEmploymentState(): EmploymentTrackerState {
  return {
    seedVersion: 1,
    applications: [
      application({
        id: 'micro1-backend-ai-evaluation',
        company: 'micro1',
        role: 'Senior Backend Engineer — AI Evaluation Platform',
        status: 'applied',
        applicationDate: '2026-09-09',
        historyDate: '2026-09-14',
        nextAction: 'Complete the long-form architecture exercise and confirm the submission window.',
      }),
      application({
        id: 'micro1-java-distributed-systems',
        company: ' Micro1 ',
        role: 'Java Distributed Systems Reviewer — Payments & Reliability',
        status: 'interview',
        applicationDate: '2026-09-08',
        historyDate: '2026-09-13',
        nextAction: 'Prepare two concise production incident examples before the technical conversation.',
      }),
      application({
        id: 'micro1-platform-rubrics',
        company: 'MICRO1',
        role: 'Staff Platform Engineer — Cloud Evaluation Rubrics',
        status: 'closed',
        applicationDate: '2026-09-07',
        historyDate: '2026-09-12',
        nextAction: 'No action; retain the outcome for future role matching.',
        createdAt: '2026-12-30T09:00:00.000Z',
      }),
      application({
        id: 'micro1-incident-analysis',
        company: 'micro1',
        role: 'Software Engineering Expert — Production Incident Analysis',
        status: 'recruiter',
        applicationDate: '2026-09-06',
        historyDate: '2026-09-08',
        nextAction: 'Reply with availability and ask which production systems the assessment covers.',
        createdAt: '2027-01-01T09:00:00.000Z',
      }),
      application({
        id: 'mercor-payments',
        company: 'Mercor',
        role: 'Senior Backend Engineer — Distributed Payments Infrastructure',
        status: 'recruiter',
        applicationDate: '2026-09-05',
        historyDate: '2026-09-11',
        nextAction: 'Confirm the interview format and prepare a short idempotent-payments design walkthrough.',
      }),
      application({
        id: 'mercor-code-review',
        company: ' mercor',
        role: 'Java Code Review Specialist — Remote Contract',
        status: 'closed',
        applicationDate: '2026-09-04',
        historyDate: '2026-09-10',
        nextAction: 'No action; keep the assessment feedback for comparison.',
        createdAt: '2026-12-31T09:00:00.000Z',
      }),
      application({
        id: 'alignerr-backend-systems',
        company: 'Alignerr',
        role: 'Backend Systems Expert — Java, APIs & Distributed Services',
        status: 'applied',
        applicationDate: '2026-09-03',
        historyDate: '2026-09-09',
        nextAction: 'Finish the platform profile and verify whether another coding assessment is required.',
      }),
      application({
        id: 'alignerr-ai-training',
        company: ' alignerr ',
        role: 'AI Training Specialist — Software Engineering Quality',
        status: 'lead',
        applicationDate: '2026-09-02',
        historyDate: '2026-09-07',
        nextAction: 'Review the work agreement and record the exact rate before accepting a project.',
      }),
      application({
        id: 'grafana-staff-ai',
        company: 'Grafana Labs',
        role: 'Staff AI Engineer — Observability Platform',
        status: 'applied',
        applicationDate: '2026-09-01',
        historyDate: '2026-09-06',
        nextAction: 'Confirm that onboarding preserves the advertised fully remote arrangement.',
      }),
      application({
        id: 'chainalysis-protocols',
        company: 'Chainalysis',
        role: 'Senior Software Engineer — Protocols & Data Services',
        status: 'recruiter',
        applicationDate: '2026-08-31',
        historyDate: '2026-09-05',
        nextAction: 'Follow up on the recruiter introduction and ask which protocol team owns the vacancy.',
      }),
      application({
        id: 'opentrade-fintech',
        company: 'OpenTrade',
        role: 'Backend Engineer — Fintech Credit Infrastructure',
        status: 'lead',
        nextAction: 'Ask for the role brief and verify UK or EMEA remote eligibility before progressing.',
      }),
    ],
  };
}
