/**
 * Runtime contracts for the Spring Boot finance service (manual accounts, transactions, budgets and savings
 * goals; the banking review; equity positions). Responses are parsed straight into the app's domain types:
 * an absent optional value arrives as `null` and becomes `undefined`. Amounts are integer pence.
 * `contracts/finance-service/*.json` holds one example per response.
 */
import { z } from 'zod';
import type {
  EquityPosition,
  FinanceAccount,
  FinanceBudget,
  FinanceReview,
  SavingsGoal,
  Transaction,
} from '../../types/domain';
import { apiErrorSchema } from './contracts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const month = z.string().regex(/^\d{4}-\d{2}$/u);
const instant = z.string().datetime({ offset: true });
const pence = z.number().int();

/** A nullable value the app keeps as an optional field (absent and null both mean "none"). */
function optional<T extends z.ZodType>(schema: T) {
  return schema.nullish().transform(value => value ?? undefined);
}

// ── Ledger ──

const expenseCategory = z.enum([
  'rent-mortgage', 'groceries', 'transport', 'bills-utilities', 'eating-out', 'subscriptions', 'entertainment',
  'clothing', 'health', 'education', 'gifts', 'personal-care', 'home', 'insurance', 'charity', 'other-expense',
]);
const incomeCategory = z.enum([
  'salary', 'freelance', 'dividends', 'interest', 'refund', 'gift-received', 'other-income',
]);

export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['current', 'savings', 'credit-card', 'isa', 'pension', 'loan-mortgage']),
  balance: pence,
  currency: z.string(),
  color: z.string(),
  icon: z.string(),
  includeInNetWorth: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: instant,
  updatedAt: instant,
}).transform((account): FinanceAccount => account);

export const transactionSchema = z.object({
  id: z.string(),
  type: z.enum(['income', 'expense', 'transfer']),
  amount: pence,
  category: z.union([expenseCategory, incomeCategory, z.literal('transfer')]),
  accountId: z.string(),
  toAccountId: optional(z.string()),
  description: z.string(),
  date: isoDate,
  tags: optional(z.array(z.string())),
  createdAt: instant,
  updatedAt: instant,
}).transform((transaction): Transaction => transaction);

export const budgetSchema = z.object({
  id: z.string(),
  category: expenseCategory,
  monthlyLimit: pence,
  createdAt: instant,
  updatedAt: instant,
}).transform((budget): FinanceBudget => budget);

export const savingsGoalSchema = z.object({
  id: z.string(),
  name: z.string(),
  targetAmount: pence,
  currentAmount: pence,
  linkedAccountId: optional(z.string()),
  icon: z.string(),
  deadline: optional(isoDate),
  completed: z.boolean(),
  completedAt: optional(instant),
  createdAt: instant,
  updatedAt: instant,
}).transform((goal): SavingsGoal => goal);

export const ledgerSchema = z.object({
  accounts: z.array(accountSchema),
  transactions: z.array(transactionSchema),
  budgets: z.array(budgetSchema),
  savingsGoals: z.array(savingsGoalSchema),
});

/** Removing an account also removes its transactions, including transfers into it. */
export const accountDeletedSchema = z.object({ id: z.string(), removedTransactionIds: z.array(z.string()) });

/** A saved transaction and every account whose balance it changed. */
export const transactionChangeSchema = z.object({ transaction: transactionSchema, accounts: z.array(accountSchema) });

/** A removed transaction and every account whose balance its reversal changed. */
export const transactionDeletedSchema = z.object({ id: z.string(), accounts: z.array(accountSchema) });

export const deletedSchema = z.object({ id: z.string() });

// ── Banking review ──

const reviewSourceSchema = z.object({ id: z.string(), label: z.string(), url: z.string(), asOf: isoDate });

const loanSchema = z.object({
  id: z.string(),
  lender: z.string(),
  purpose: z.string(),
  status: z.enum(['active', 'repaid', 'closed']),
  monthlyPaymentPence: optional(pence),
  userSharePence: optional(pence),
  balancePence: optional(pence),
  balanceAsOf: optional(isoDate),
  balanceKind: z.enum(['statement', 'settlement', 'estimate', 'unknown']),
  settlementPence: optional(pence),
  settlementAsOf: optional(isoDate),
  nextPaymentDate: optional(isoDate),
  paymentsRemaining: optional(z.number().int()),
  originalPrincipalPence: optional(pence),
  startDate: optional(isoDate),
  endDate: optional(isoDate),
  aprPercent: optional(z.number()),
  rateNote: z.string(),
  notes: z.string(),
  sourceIds: z.array(z.string()),
});

export const financeReviewSchema = z.object({
  id: z.string(),
  asOf: isoDate,
  currency: z.literal('GBP'),
  coverage: z.object({
    from: isoDate, to: isoDate, completeThrough: z.string(), transactionCount: z.number().int(),
    accountCount: z.number().int(), note: z.string(),
  }),
  accounts: z.array(z.object({
    id: z.string(), label: z.string(), ownership: z.enum(['personal', 'household']), balancePence: pence, asOf: isoDate,
  })),
  months: z.array(z.object({
    month, incomePence: pence, outflowPence: pence, netPence: pence, salaryPence: pence,
    categories: z.array(z.object({ label: z.string(), amountPence: pence })),
  })),
  budget: z.object({
    incomePence: pence,
    incomeBasis: z.string(),
    essentials: z.array(z.object({ label: z.string(), amountPence: pence, note: z.string() })),
    workCostsPence: pence,
    workCostsNote: z.string(),
    scenarios: z.array(z.object({
      label: z.string(), status: z.enum(['planned', 'confirmed']), monthlyAdjustmentPence: pence, note: z.string(),
    })),
  }),
  opportunities: z.array(z.object({
    label: z.string(), monthlyPence: pence, note: z.string(), suggestedCapPence: optional(pence),
  })),
  loans: z.array(loanSchema),
  notes: z.array(z.string()),
  sources: z.array(reviewSourceSchema),
  createdAt: instant,
  updatedAt: instant,
}).transform((review): FinanceReview => review);

/** The account's banking review, or null before the first save. */
export const reviewEnvelopeSchema = z.object({ review: financeReviewSchema.nullable() });

export const reviewSavedSchema = z.object({ review: financeReviewSchema });

// ── Equity ──

const planSchema = z.object({
  summary: z.string(),
  status: z.enum(['agreed', 'tentative', 'undecided']),
  waitingFor: z.string(),
  nextAction: z.string(),
  reviewMonth: optional(month),
});

const grantSchema = z.object({
  id: z.string(),
  grantDate: isoDate,
  vested: z.number(),
  unvested: z.number(),
  strikeUsd: z.number(),
  originalExpiry: isoDate,
  postEmploymentExpiry: optional(isoDate),
  nextVest: optional(z.object({
    date: isoDate, alternateDate: optional(isoDate), quantity: z.number(), condition: z.string(),
  })),
});

export const equityPositionSchema = z.object({
  id: z.string(),
  company: z.string(),
  asOf: isoDate,
  ownedShares: z.number(),
  stockPlan: planSchema,
  optionPlan: planSchema,
  employmentNote: z.string(),
  grants: z.array(grantSchema),
  actions: z.array(z.object({
    id: z.string(), title: z.string(), timing: z.string(), dueDate: optional(isoDate), done: z.boolean(),
  })),
  details: z.array(z.object({ id: z.string(), title: z.string(), body: z.string() })),
  sources: z.array(z.object({ id: z.string(), label: z.string(), url: z.string(), asOf: isoDate })),
  scenario: z.object({
    pricesUsd: z.array(z.number()), withholdingRate: z.number(), usdToGbp: z.number(), asOf: isoDate, notes: z.string(),
  }),
  createdAt: instant,
  updatedAt: instant,
}).transform((position): EquityPosition => position);

export const equityPositionsSchema = z.object({
  positions: z.array(equityPositionSchema),
  total: z.number().int(),
});

export type FinanceLedger = z.infer<typeof ledgerSchema>;
export type FinanceAccountDeleted = z.infer<typeof accountDeletedSchema>;
export type FinanceTransactionChange = z.infer<typeof transactionChangeSchema>;
export type FinanceTransactionDeleted = z.infer<typeof transactionDeletedSchema>;
export type EquityPositionPage = z.infer<typeof equityPositionsSchema>;

/** Every contracts/finance-service fixture and the schema its body must satisfy. */
export const FINANCE_CONTRACT_SCHEMAS: Record<string, z.ZodType> = {
  'finance-service/ledger': ledgerSchema,
  'finance-service/account-saved': accountSchema,
  'finance-service/account-deleted': accountDeletedSchema,
  'finance-service/transaction-saved': transactionChangeSchema,
  'finance-service/transaction-deleted': transactionDeletedSchema,
  'finance-service/budget-saved': budgetSchema,
  'finance-service/budget-deleted': deletedSchema,
  'finance-service/savings-goal-saved': savingsGoalSchema,
  'finance-service/savings-goal-deleted': deletedSchema,
  'finance-service/review': reviewEnvelopeSchema,
  'finance-service/review-empty': reviewEnvelopeSchema,
  'finance-service/review-saved': reviewSavedSchema,
  'finance-service/review-changed': apiErrorSchema,
  'finance-service/equity-positions': equityPositionsSchema,
  'finance-service/equity-position': equityPositionSchema,
  'finance-service/position-saved': equityPositionSchema,
  'finance-service/position-deleted': deletedSchema,
  'finance-service/position-changed': apiErrorSchema,
  'finance-service/transaction-invalid': apiErrorSchema,
  'finance-service/rate-limited': apiErrorSchema,
  'finance-service/agent-not-approved': apiErrorSchema,
};
