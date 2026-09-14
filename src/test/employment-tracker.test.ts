import { describe, expect, it } from 'vitest';
import {
  createDefaultEmploymentTrackerState,
  getEmploymentActivity,
  getEmploymentActivityDate,
  getEmploymentSummary,
  groupEmploymentApplications,
  matchesEmploymentFilters,
  normalizeEmploymentApplicationDraft,
  type EmploymentApplicationDraft,
  type EmploymentFilters,
} from '../services/employmentTracker';
import { createRepresentativeEmploymentState } from '../../e2e/support/employment-scenario';
import { decodeStoreValue, encodeStoreValue } from '../store/recordCodec';
import { resolveSurfaceReference } from '../assistant/entityResolver';

describe('Employment tracker seeds', () => {
  it('contains only the three confirmed opportunities without invented details', () => {
    const state = createDefaultEmploymentTrackerState();

    expect(state.seedVersion).toBe(1);
    expect(state.applications.map(application => application.company)).toEqual([
      'Grafana Labs',
      'OpenTrade',
      'Chainalysis',
    ]);

    const grafana = state.applications[0];
    expect(grafana).toMatchObject({
      role: 'Staff AI Engineer, 2nd Horizon, UK Remote',
      workType: 'unknown',
      remoteRegion: 'uk',
      remoteStatus: 'needs_verification',
      applicationDate: '2026-08-29',
      status: 'applied',
      notes: 'Application submitted and receipt verified.',
    });
    expect(grafana.url).toBeUndefined();
    expect(grafana.remoteEvidence).toContain('100% remote');
    expect(grafana.remoteCaveat).toContain('in-person onboarding');

    const openTrade = state.applications[1];
    expect(openTrade).toMatchObject({
      role: 'Fullstack / Backend — fintech / Web3',
      compensation: '$160k–$200k plus equity',
      status: 'recruiter',
      remoteRegion: 'unknown',
      workType: 'unknown',
    });
    expect(openTrade.applicationDate).toBeUndefined();
    expect(openTrade.url).toBeUndefined();

    const chainalysis = state.applications[2];
    expect(chainalysis).toMatchObject({
      role: 'Senior Software Engineer, Protocols',
      status: 'recruiter',
      remoteRegion: 'unknown',
      workType: 'unknown',
    });
    expect(chainalysis.applicationDate).toBeUndefined();
    expect(chainalysis.compensation).toBeUndefined();
    expect(chainalysis.url).toBeUndefined();
  });

  it('round-trips as one account-backed singleton record', () => {
    const state = createDefaultEmploymentTrackerState();
    const encoded = encodeStoreValue('employment', state);

    expect(encoded).toEqual([{
      recordId: 'singleton',
      payload: state,
      position: null,
    }]);
    expect(decodeStoreValue('employment', encoded)).toEqual(state);
  });
});

describe('Employment tracker rules', () => {
  const baseDraft: EmploymentApplicationDraft = {
    company: 'Example Ltd',
    role: 'Backend Engineer',
    workType: 'contract',
    remoteRegion: 'uk',
    remoteStatus: 'confirmed',
    remoteEvidence: 'Role page confirms fully remote work in the UK.',
    status: 'lead',
    nextAction: 'Apply',
    notes: '',
    history: [],
  };

  it('requires evidence and eligible region before remote status can be confirmed', () => {
    expect(() => normalizeEmploymentApplicationDraft({
      ...baseDraft,
      remoteEvidence: '  ',
    })).toThrow('Record the fully remote evidence');
    expect(() => normalizeEmploymentApplicationDraft({
      ...baseDraft,
      remoteRegion: 'unknown',
    })).toThrow('Confirmed remote roles must record UK, EMEA, or global eligibility.');
  });

  it('accepts only http or https evidence links', () => {
    expect(() => normalizeEmploymentApplicationDraft({
      ...baseDraft,
      url: 'javascript:alert(1)',
    })).toThrow('Role URL must use http or https.');
    expect(() => normalizeEmploymentApplicationDraft({
      ...baseDraft,
      history: [{
        id: 'history-1',
        kind: 'remote_evidence',
        summary: 'Advert checked',
        details: '',
        evidenceUrl: 'file:///tmp/advert',
      }],
    })).toThrow('Evidence URL must use http or https.');
  });

  it('filters the pipeline and counts one confirmed Grafana activity event for 29 August', () => {
    const applications = createDefaultEmploymentTrackerState().applications;
    const filters: EmploymentFilters = {
      query: 'equity',
      status: 'recruiter',
      workType: 'all',
      remoteStatus: 'needs_verification',
    };

    expect(applications.filter(application => matchesEmploymentFilters(application, filters)))
      .toEqual([applications[1]]);
    expect(getEmploymentActivity(applications).filter(entry => entry.date === '2026-08-29'))
      .toHaveLength(1);
    expect(getEmploymentSummary(applications, '2026-08-29')).toEqual({
      active: 3,
      recruiter: 2,
      applied: 1,
      needsRemoteVerification: 3,
      activityToday: 1,
    });
  });

  it('groups company names case-insensitively and preserves distinct roles in source-date order', () => {
    const applications = createRepresentativeEmploymentState().applications;
    const groups = groupEmploymentApplications(applications);
    const micro1 = groups.find(group => group.key === 'micro1');

    expect(groups).toHaveLength(6);
    expect(groups.flatMap(group => group.applications)).toHaveLength(11);
    expect(new Set(groups.flatMap(group => group.applications.map(application => application.id))).size).toBe(11);
    expect(micro1?.applications.map(application => application.id)).toEqual([
      'micro1-backend-ai-evaluation',
      'micro1-java-distributed-systems',
      'micro1-incident-analysis',
      'micro1-platform-rubrics',
    ]);
    expect(getEmploymentActivityDate(micro1!.applications[0])).toBe('2026-09-14');
    expect(micro1!.applications[2].createdAt).toBe('2027-01-01T09:00:00.000Z');
    expect(micro1!.applications.at(-1)?.createdAt).toBe('2026-12-30T09:00:00.000Z');
  });

  it('grounds Employment as an assistant navigation surface', () => {
    expect(resolveSurfaceReference('Open the employment application tracker').best?.data)
      .toBe('employment');
  });
});
