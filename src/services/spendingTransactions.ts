import type { FinanceReview, FinanceReviewTransaction } from '../types/domain';

export function spendingTransactions(review: FinanceReview, month: string, category?: string): FinanceReviewTransaction[] {
  const personalIds = new Set(review.accounts.filter(account => account.ownership === 'personal').map(account => account.id));
  return (review.transactions ?? []).filter(item => personalIds.has(item.accountId) && item.month === month
    && (!category || item.category.trim().toLowerCase() === category.trim().toLowerCase()))
    .sort((a, b) => (b.date ?? b.month).localeCompare(a.date ?? a.month) || a.id.localeCompare(b.id));
}

export function transactionMatches(item: FinanceReviewTransaction, query: string): boolean {
  const text = [item.merchant, item.description, item.category, item.detail, item.date, item.recurrence].join(' ').toLowerCase();
  return text.includes(query.trim().toLowerCase());
}
