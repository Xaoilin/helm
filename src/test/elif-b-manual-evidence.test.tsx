import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ElifBManualEvidence from '../components/knowledge/ElifBManualEvidence';
import {
  buildElifBManualEvidenceInput,
  ELIF_B_MANUAL_FRESHNESS,
  ELIF_B_MANUAL_PROVENANCE,
  ELIF_B_MANUAL_STATUS,
} from '../services/elifBManualEvidence';
import type { LifeHeroEvidenceReceipt } from '../types/domain';

const acceptEvidence = vi.hoisted(() => vi.fn());

vi.mock('../store/supabase', () => ({
  acceptLifeHeroEvidence: acceptEvidence,
}));

function receipt(duplicate = false): LifeHeroEvidenceReceipt {
  return {
    duplicate,
    evidence: {
      id: 'evidence-id',
      rulesetVersion: 'life-hero-v1',
      stat: 'knowledge',
      evidenceType: 'knowledge_learning',
      sourceTier: 'self_reported',
      sourceReference: 'elif-b:manual:1234abcd',
      idempotencyKey: 'elif-b-manual:1234abcd',
      occurredAt: '2026-08-30T12:00:00.000Z',
      localDate: '2026-08-30',
      metadata: {
        provider: 'Elif B',
        status: ELIF_B_MANUAL_STATUS,
        freshness: ELIF_B_MANUAL_FRESHNESS,
        provenance: ELIF_B_MANUAL_PROVENANCE,
        qualifyingReason: 'completed_learning_session',
        confirmedAt: '2026-08-30T12:00:00.000Z',
      },
      createdAt: '2026-08-30T12:00:00.000Z',
    },
    award: {
      id: 'award-id',
      evidenceId: 'evidence-id',
      rulesetVersion: 'life-hero-v1',
      stat: 'knowledge',
      baseXp: 20,
      sourceMultiplier: 0.75,
      momentumDays: 1,
      momentumMultiplier: 1,
      awardedXp: 15,
      awardedAt: '2026-08-30T12:00:00.000Z',
    },
    snapshot: {} as LifeHeroEvidenceReceipt['snapshot'],
  };
}

describe('Elif B manual evidence', () => {
  beforeEach(() => {
    acceptEvidence.mockReset().mockResolvedValue(receipt());
  });

  it('builds self-reported evidence with minimal attributable metadata', () => {
    const input = buildElifBManualEvidenceInput({
      sessionLabel: ' Session 1 ',
      localDate: '2026-08-30',
      providerConfirmed: true,
    }, new Date('2026-08-30T12:34:56.000Z'));

    expect(input).toMatchObject({
      evidenceType: 'knowledge_learning',
      sourceTier: 'self_reported',
      sourceReference: expect.stringMatching(/^elif-b:manual:[0-9a-f]{8}$/u),
      idempotencyKey: expect.stringMatching(/^elif-b-manual:[0-9a-f]{8}$/u),
      occurredAt: '2026-08-30T12:00:00.000Z',
      localDate: '2026-08-30',
      metadata: {
        provider: 'Elif B',
        status: ELIF_B_MANUAL_STATUS,
        freshness: ELIF_B_MANUAL_FRESHNESS,
        provenance: ELIF_B_MANUAL_PROVENANCE,
        qualifyingReason: 'completed_learning_session',
        confirmedAt: '2026-08-30T12:34:56.000Z',
      },
    });
    expect(input.metadata).not.toHaveProperty('sessionLabel');
    expect(input.metadata).not.toHaveProperty('courseContent');
  });

  it('derives the same identity for a repeated session and fails unsafe or incomplete input closed', () => {
    const draft = { sessionLabel: 'Session 1', localDate: '2026-08-30', providerConfirmed: true };
    expect(buildElifBManualEvidenceInput(draft).sourceReference)
      .toBe(buildElifBManualEvidenceInput({ ...draft, sessionLabel: ' session 1 ' }).sourceReference);
    expect(() => buildElifBManualEvidenceInput({ ...draft, providerConfirmed: false })).toThrow(/Confirm/u);
    expect(() => buildElifBManualEvidenceInput({ ...draft, localDate: '2026-02-30' })).toThrow(/valid session date/u);
    expect(() => buildElifBManualEvidenceInput({ ...draft, sessionLabel: 'https://example.com' })).toThrow(/short session label/u);
    expect(() => buildElifBManualEvidenceInput({ ...draft, sessionLabel: 'person@example.com' })).toThrow(/contact details/u);
  });

  it('makes the user-assisted confirmation boundary and provider status explicit', async () => {
    render(<ElifBManualEvidence />);

    expect(screen.getByText(/user-confirmed and never provider-verified/u)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Record completed session' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('e.g. Session 1'), { target: { value: 'Session 1' } });
    fireEvent.change(screen.getByLabelText('Completed session date'), { target: { value: '2026-08-30' } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit).toBeEnabled();

    await act(async () => {
      fireEvent.click(submit);
    });

    expect(acceptEvidence).toHaveBeenCalledWith(expect.objectContaining({
      evidenceType: 'knowledge_learning',
      sourceTier: 'self_reported',
      metadata: expect.objectContaining({ status: ELIF_B_MANUAL_STATUS }),
    }));
    expect(screen.getByRole('status')).toHaveTextContent(/Session recorded/u);
    expect(screen.getByRole('status')).toHaveTextContent(/not provider verified/u);
  });

  it('reports duplicate and provider/save failures without inventing completion', async () => {
    acceptEvidence.mockResolvedValueOnce(receipt(true));
    render(<ElifBManualEvidence />);
    fireEvent.change(screen.getByPlaceholderText('e.g. Session 1'), { target: { value: 'Session 1' } });
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record completed session' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent(/already recorded/u);

    acceptEvidence.mockRejectedValueOnce(new Error('A signed-in Sabah One account is required.'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Session 1'), { target: { value: 'Session 2' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record completed session' }));
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/signed-in Sabah One account/u));
    expect(screen.queryByText('Session recorded.')).not.toBeInTheDocument();
  });
});
