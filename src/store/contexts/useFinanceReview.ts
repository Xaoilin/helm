/**
 * The banking review, a private dated snapshot kept by the finance service (one per account) and separate
 * from manual accounts. The app saves expense-group choices; agents refresh it through Finance MCP. A failed reload
 * keeps the last confirmed review on screen and says it may be out of date.
 */
import { useCallback, useRef, useState } from 'react';
import type { ExpenseGroup, FinanceReview } from '../../types/domain';
import { getReview, isFinanceServiceEnabled, saveReview } from '../../services/backend/financeServiceApi';
import { normalizeExpenseLabel } from '../../services/expenseGroups';
import { LIVE_DOMAINS } from '../../services/backend/liveDomains';
import { useServiceLoad } from './useServiceLoad';

export interface FinanceReviewState {
  review: FinanceReview | null;
  loaded: boolean;
  error: string | null;
  /** The shown review is the last confirmed one and may be out of date. */
  stale: boolean;
  refresh: () => Promise<void>;
  saving: boolean;
  moveExpense: (label: string, group: ExpenseGroup) => Promise<void>;
}

export function useFinanceReview(): FinanceReviewState {
  const [review, setReview] = useState<FinanceReview | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const revision = useRef(0);
  const load = useCallback(async () => {
    const started = ++revision.current;
    const confirmed = await getReview();
    if (started === revision.current) setReview(confirmed);
  }, []);
  const { loaded, error, reload, reportFailure } = useServiceLoad('Banking review', isFinanceServiceEnabled(), load,
    LIVE_DOMAINS.finance);
  const moveExpense = async (label: string, group: ExpenseGroup) => {
    if (!review || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const draft = {
      asOf: review.asOf, currency: review.currency, coverage: review.coverage, accounts: review.accounts,
      months: review.months, budget: review.budget, opportunities: review.opportunities,
      loans: review.loans, notes: review.notes, sources: review.sources,
    };
    const expenseGroups = (review.expenseGroups ?? []).filter(item =>
      normalizeExpenseLabel(item.label) !== normalizeExpenseLabel(label));
    try {
      const confirmed = await saveReview({ ...draft, expenseGroups: [...expenseGroups, { label, group }] }, review.updatedAt);
      if (!confirmed.expenseGroups?.some(item => normalizeExpenseLabel(item.label) === normalizeExpenseLabel(label)
        && item.group === group)) throw new Error('The finance service did not confirm your expense group. Reload and try again.');
      // An older in-flight read must not replace this server-confirmed write.
      revision.current++;
      setReview(confirmed);
    } catch (failure) {
      reportFailure(failure);
      throw failure;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return { review, loaded, error, stale: Boolean(error) && review !== null, refresh: reload, saving, moveExpense };
}
