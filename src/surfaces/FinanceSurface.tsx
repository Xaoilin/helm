import { useState, useMemo } from 'react';
import { useApp } from '../store/AppContext';
import type { TransactionType, TransactionCategory, ExpenseCategory, FinanceAccount, FinanceAccountType, Transaction } from '../types/domain';
import { MONZO_ACCESS_TOKEN } from '../config';
import { fetchMonzoAccounts, fetchMonzoTransactions, mapMonzoTransaction, isAlreadyImported, verifyToken } from '../services/monzoApi';
import {
  formatGBP, parseToPence, toMonthStr, toLocalDateStr,
  calculateNetWorth, monthlyTotals, categorySpend,
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, getCategoryDef,
  ACCOUNT_TYPES, ACCOUNT_COLORS,
} from '../services/financeHelpers';

type Tab = 'overview' | 'transactions' | 'accounts' | 'budgets';

export default function FinanceSurface() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('overview');
  const todayStr = toLocalDateStr(new Date());
  const currentMonth = toMonthStr(new Date());

  // Quick-add state
  const [txType, setTxType] = useState<TransactionType>('expense');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState<TransactionCategory>('groceries');
  const [txDesc, setTxDesc] = useState('');
  const [txAccountId, setTxAccountId] = useState('');
  const [showTxDetails, setShowTxDetails] = useState(false);
  const [txSaved, setTxSaved] = useState(false);

  // Account form
  const [showAccForm, setShowAccForm] = useState(false);
  const [editingAcc, setEditingAcc] = useState<FinanceAccount | null>(null);
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<FinanceAccountType>('current');
  const [accBalance, setAccBalance] = useState('');
  const [accColor, setAccColor] = useState(ACCOUNT_COLORS[0]);

  // Budget form
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [budgetCat, setBudgetCat] = useState<ExpenseCategory>('groceries');
  const [budgetLimit, setBudgetLimit] = useState('');

  // Goal form
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalCurrent, setGoalCurrent] = useState('');
  const goalIcon = '\u{1F3E6}';

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | TransactionType>('all');
  const [monzoSyncing, setMonzoSyncing] = useState(false);
  const [monzoStatus, setMonzoStatus] = useState<string | null>(null);

  // ── Derived data ──
  const netWorth = useMemo(() => calculateNetWorth(app.financeAccounts), [app.financeAccounts]);
  const monthly = useMemo(() => monthlyTotals(app.transactions, currentMonth), [app.transactions, currentMonth]);
  const defaultAccountId = app.financeAccounts[0]?.id || '';

  const recentTxs = useMemo(() =>
    [...app.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 10),
    [app.transactions]
  );

  const filteredTxs = useMemo(() => {
    let txs = [...app.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    if (filterType !== 'all') txs = txs.filter(t => t.type === filterType);
    return txs;
  }, [app.transactions, filterType]);

  // ── Quick add ──
  const handleQuickAdd = () => {
    const amount = parseToPence(txAmount);
    if (!amount || !txCategory) return;
    const accountId = txAccountId || defaultAccountId;
    if (!accountId) return;
    app.addTransaction({ type: txType, amount, category: txCategory, accountId, description: txDesc.trim(), date: todayStr, toAccountId: undefined });
    setTxAmount(''); setTxDesc('');
    setTxSaved(true); setTimeout(() => setTxSaved(false), 2000);
  };

  // ── Account CRUD ──
  const openAddAcc = () => { setAccName(''); setAccType('current'); setAccBalance(''); setAccColor(ACCOUNT_COLORS[0]); setEditingAcc(null); setShowAccForm(true); };
  const openEditAcc = (a: FinanceAccount) => { setAccName(a.name); setAccType(a.type); setAccBalance((a.balance / 100).toFixed(2)); setAccColor(a.color); setEditingAcc(a); setShowAccForm(true); };
  const saveAcc = () => {
    if (!accName.trim()) return;
    const balance = parseToPence(accBalance);
    const isDebt = ACCOUNT_TYPES.find(t => t.value === accType)?.isDebt;
    if (editingAcc) {
      app.updateFinanceAccount(editingAcc.id, { name: accName.trim(), type: accType, balance, color: accColor });
    } else {
      app.addFinanceAccount({ name: accName.trim(), type: accType, balance: isDebt ? -Math.abs(balance) : balance, currency: 'GBP', color: accColor, icon: ACCOUNT_TYPES.find(t => t.value === accType)?.icon || '\u{1F3E6}', includeInNetWorth: true, sortOrder: app.financeAccounts.length });
    }
    setShowAccForm(false);
  };

  // ── Render helpers ──
  const renderTxRow = (tx: Transaction) => {
    const cat = getCategoryDef(tx.category);
    const acc = app.financeAccounts.find(a => a.id === tx.accountId);
    return (
      <div key={tx.id} className="finance-tx-row">
        <span className="finance-tx-icon">{cat.icon}</span>
        <div className="finance-tx-info">
          <div className="finance-tx-desc">{tx.description || cat.label}</div>
          <div className="finance-tx-meta">{cat.label}{acc ? ` \u00b7 ${acc.name}` : ''} \u00b7 {tx.date}</div>
        </div>
        <div className={`finance-tx-amount ${tx.type}`}>
          {tx.type === 'expense' ? '-' : tx.type === 'income' ? '+' : ''}{formatGBP(tx.amount)}
        </div>
        <div className="task-actions">
          {deletingId === tx.id ? (
            <div className="confirm-bar" role="alert" style={{ margin: 0, padding: '3px 6px', fontSize: 9 }}>
              <button className="btn btn-danger btn-sm" onClick={() => { app.removeTransaction(tx.id); setDeletingId(null); }}>Yes</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setDeletingId(null)}>No</button>
            </div>
          ) : (
            <button className="btn-icon btn-sm" onClick={() => setDeletingId(tx.id)} style={{ fontSize: 11, color: '#ff6b6b' }}>&times;</button>
          )}
        </div>
      </div>
    );
  };

  // ── Monzo sync ──
  const MONZO_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6'];
  let monzoAccountIndex = 0;
  const handleMonzoSync = async () => {
    if (!MONZO_ACCESS_TOKEN) { setMonzoStatus('No Monzo token configured. Add VITE_MONZO_ACCESS_TOKEN to .env'); return; }
    setMonzoSyncing(true); setMonzoStatus(null);
    try {
      const valid = await verifyToken(MONZO_ACCESS_TOKEN);
      if (!valid) { setMonzoStatus('Monzo token expired. Get a new one from developers.monzo.com'); setMonzoSyncing(false); return; }

      const monzoAccounts = await fetchMonzoAccounts(MONZO_ACCESS_TOKEN);
      if (monzoAccounts.length === 0) { setMonzoStatus('No Monzo accounts found.'); setMonzoSyncing(false); return; }

      let totalImported = 0;
      let accountsSynced = 0;
      const accountsSkipped: string[] = [];
      for (const mAcc of monzoAccounts) {
        // Find HELM account by Monzo account ID tag, or create one
        const monzoTag = `monzo:${mAcc.id}`;
        const helmAcc = app.financeAccounts.find(a =>
          app.transactions.some(t => t.accountId === a.id && t.tags?.includes(monzoTag))
        ) || app.financeAccounts.find(a => a.name === `Monzo ${mAcc.description || 'Account'}`);
        let helmAccId: string;
        if (!helmAcc) {
          helmAccId = app.addFinanceAccount({
            name: `Monzo ${mAcc.description || 'Account'}`,
            type: mAcc.type?.includes('savings') ? 'savings' : 'current',
            balance: 0, currency: 'GBP',
            color: MONZO_COLORS[monzoAccountIndex++ % MONZO_COLORS.length],
            icon: '\u{1F3E6}',
            includeInNetWorth: true, sortOrder: app.financeAccounts.length,
          });
        } else {
          helmAccId = helmAcc.id;
        }

        // Fetch and import transactions — handle 403 (SCA required) per account
        try {
          const monzoTxs = await fetchMonzoTransactions(MONZO_ACCESS_TOKEN, mAcc.id);
          for (const mTx of monzoTxs) {
            if (!isAlreadyImported(mTx.id, app.transactions)) {
              const mapped = mapMonzoTransaction(mTx, helmAccId);
              app.addTransaction(mapped);
              totalImported++;
            }
          }
          accountsSynced++;
        } catch (accErr) {
          const msg = accErr instanceof Error ? accErr.message : '';
          if (msg.includes('403')) {
            accountsSkipped.push(mAcc.description || mAcc.id);
          } else {
            accountsSkipped.push(`${mAcc.description || mAcc.id} (${msg.slice(0, 50)})`);
          }
        }
      }

      let statusMsg = `Synced ${accountsSynced} account${accountsSynced !== 1 ? 's' : ''}, ${totalImported} new transaction${totalImported !== 1 ? 's' : ''}.`;
      if (accountsSkipped.length > 0) {
        statusMsg += ` Skipped ${accountsSkipped.length} (need approval in Monzo app): ${accountsSkipped.join(', ')}`;
      }
      setMonzoStatus(statusMsg);
    } catch (err) {
      setMonzoStatus(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setMonzoSyncing(false);
    }
  };

  const quickAddBar = (
    <div className="finance-quick-add">
      <div className="finance-type-toggle">
        <button className={`btn btn-sm ${txType === 'expense' ? 'active expense' : ''}`} onClick={() => { setTxType('expense'); setTxCategory('groceries'); }}>Expense</button>
        <button className={`btn btn-sm ${txType === 'income' ? 'active income' : ''}`} onClick={() => { setTxType('income'); setTxCategory('salary'); }}>Income</button>
      </div>
      <div className="finance-amount-wrap">
        <span className="finance-pound">\u00a3</span>
        <input
          className="finance-amount-input"
          type="number" step="0.01" min="0"
          placeholder="0.00" value={txAmount}
          onChange={e => setTxAmount(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }}
        />
      </div>
      <select className="form-select" style={{ minWidth: 130, fontSize: 12 }} value={txCategory} onChange={e => setTxCategory(e.target.value as TransactionCategory)}>
        {(txType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map(c => (
          <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
        ))}
      </select>
      {showTxDetails && (
        <>
          <input className="form-input" style={{ maxWidth: 150, fontSize: 12, padding: '5px 8px' }} placeholder="Description..." value={txDesc} onChange={e => setTxDesc(e.target.value)} />
          {app.financeAccounts.length > 1 && (
            <select className="form-select" style={{ maxWidth: 120, fontSize: 12 }} value={txAccountId || defaultAccountId} onChange={e => setTxAccountId(e.target.value)}>
              {app.financeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </>
      )}
      <button className="btn-icon btn-sm" onClick={() => setShowTxDetails(!showTxDetails)} title="More options" style={{ fontSize: 11 }}>{showTxDetails ? '\u25B2' : '\u25BC'}</button>
      <button className="btn btn-primary btn-sm" onClick={handleQuickAdd} disabled={!txAmount || !parseToPence(txAmount)}>
        {txSaved ? '\u2713' : '+'}
      </button>
    </div>
  );

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Finance</h1>
          <div className="subtitle">Net worth: {formatGBP(netWorth)}</div>
        </div>
        <button className="btn btn-primary" onClick={openAddAcc}>+ Account</button>
      </div>
      <div className="surface-body">
        <div className="tabs">
          <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
          <button className={`tab ${tab === 'transactions' ? 'active' : ''}`} onClick={() => setTab('transactions')}>Transactions{app.transactions.length > 0 && <span style={{ marginLeft: 4, fontSize: 10, color: '#6b6f85' }}>{app.transactions.length}</span>}</button>
          <button className={`tab ${tab === 'accounts' ? 'active' : ''}`} onClick={() => setTab('accounts')}>Accounts{app.financeAccounts.length > 0 && <span style={{ marginLeft: 4, fontSize: 10, color: '#6b6f85' }}>{app.financeAccounts.length}</span>}</button>
          <button className={`tab ${tab === 'budgets' ? 'active' : ''}`} onClick={() => setTab('budgets')}>Budgets & Goals</button>
        </div>

        {/* ══ Overview ══ */}
        {tab === 'overview' && (
          <>
            {app.financeAccounts.length === 0 ? (
              <div className="empty-state" role="status">
                <div className="empty-icon" style={{ fontSize: 36 }}>{'\u{1F4B7}'}</div>
                <h3>Set up your finances</h3>
                <p>Add your first bank account to start tracking income and expenses.</p>
                <button className="btn btn-primary" onClick={openAddAcc}>+ Add Account</button>
              </div>
            ) : (
              <>
                {quickAddBar}
                <div className="dash-grid" style={{ marginTop: 16 }}>
                  {/* Monthly Summary */}
                  <div className="dash-card">
                    <div className="dash-card-header"><span>This Month</span></div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#22c55e', fontSize: 13 }}>Income</span>
                        <span style={{ color: '#22c55e', fontWeight: 600 }}>{formatGBP(monthly.income)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#ff6b6b', fontSize: 13 }}>Expenses</span>
                        <span style={{ color: '#ff6b6b', fontWeight: 600 }}>{formatGBP(monthly.expenses)}</span>
                      </div>
                      <div style={{ borderTop: '1px solid #1e2030', paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>Net</span>
                        <span style={{ fontWeight: 700, color: monthly.net >= 0 ? '#22c55e' : '#ff6b6b' }}>{monthly.net >= 0 ? '+' : ''}{formatGBP(monthly.net)}</span>
                      </div>
                      {monthly.income > 0 && (
                        <div className="progress-bar" style={{ marginTop: 4 }}>
                          <div className="progress-fill" style={{ width: `${Math.min(100, (monthly.expenses / monthly.income) * 100)}%`, background: monthly.expenses > monthly.income ? '#ff6b6b' : '#4f5bff' }} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Net Worth */}
                  <div className="dash-card">
                    <div className="dash-card-header"><span>Net Worth</span></div>
                    <div className="finance-net-worth">{formatGBP(netWorth)}</div>
                    <div style={{ marginTop: 8 }}>
                      {app.financeAccounts.sort((a, b) => b.balance - a.balance).map(acc => (
                        <div key={acc.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: '#9499b0' }}>
                          <span>{acc.icon} {acc.name}</span>
                          <span style={{ color: acc.balance < 0 ? '#ff6b6b' : '#e1e4ea', fontWeight: 500 }}>{formatGBP(acc.balance)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Budget status */}
                {app.financeBudgets.length > 0 && (
                  <div className="dash-card" style={{ marginTop: 16 }}>
                    <div className="dash-card-header"><span>Budget Status</span></div>
                    {app.financeBudgets.map(b => {
                      const spent = categorySpend(app.transactions, b.category, currentMonth);
                      const pct = b.monthlyLimit > 0 ? (spent / b.monthlyLimit) * 100 : 0;
                      const cat = getCategoryDef(b.category);
                      return (
                        <div key={b.id} className="finance-budget-row">
                          <span className="finance-budget-label">{cat.icon} {cat.label}</span>
                          <div className="finance-budget-bar-wrap">
                            <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, pct)}%`, background: pct > 90 ? '#ff6b6b' : pct > 75 ? '#f59e0b' : '#4f5bff' }} /></div>
                          </div>
                          <span className="finance-budget-values">{formatGBP(spent)} / {formatGBP(b.monthlyLimit)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Recent transactions */}
                {recentTxs.length > 0 && (
                  <div className="dash-card" style={{ marginTop: 16 }}>
                    <div className="dash-card-header"><span>Recent Transactions</span></div>
                    {recentTxs.map(renderTxRow)}
                    <button className="dash-card-link" onClick={() => setTab('transactions')}>See all &rarr;</button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ══ Transactions ══ */}
        {tab === 'transactions' && (
          <>
            {app.financeAccounts.length > 0 && quickAddBar}
            <div className="filter-bar" style={{ marginTop: 12 }}>
              {(['all', 'expense', 'income', 'transfer'] as const).map(f => (
                <button key={f} className={`btn btn-sm ${filterType === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilterType(f)}>
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
              <span className="count" style={{ marginLeft: 'auto' }}>{filteredTxs.length} transaction{filteredTxs.length !== 1 ? 's' : ''}</span>
            </div>
            {filteredTxs.length === 0 ? (
              <div className="empty-state" role="status">
                <div className="empty-icon" style={{ fontSize: 36 }}>{'\u{1F4B7}'}</div>
                <h3>No transactions</h3>
                <p>Log your first income or expense to get started.</p>
              </div>
            ) : filteredTxs.map(renderTxRow)}
          </>
        )}

        {/* ══ Accounts ══ */}
        {tab === 'accounts' && (
          <>
            {/* Monzo sync */}
            {MONZO_ACCESS_TOKEN && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '10px 14px', background: '#181b27', border: '1px solid #242740', borderRadius: 8 }}>
                <span style={{ fontSize: 18 }}>{'\u{1F3E6}'}</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#e1e4ea' }}>Monzo</span>
                <button className="btn btn-primary btn-sm" onClick={handleMonzoSync} disabled={monzoSyncing}>
                  {monzoSyncing ? 'Syncing...' : 'Sync Monzo'}
                </button>
                {monzoStatus && <span style={{ fontSize: 11, color: monzoStatus.includes('failed') || monzoStatus.includes('expired') ? '#ff6b6b' : '#22c55e' }}>{monzoStatus}</span>}
                <a href="https://developers.monzo.com/" target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: 10, color: '#4f5bff' }}>Get token</a>
              </div>
            )}
            {app.financeAccounts.length === 0 ? (
              <div className="empty-state" role="status">
                <div className="empty-icon" style={{ fontSize: 36 }}>{'\u{1F3E6}'}</div>
                <h3>No accounts</h3>
                <p>Add your bank accounts, savings, and credit cards.</p>
                <button className="btn btn-primary" onClick={openAddAcc}>+ Add Account</button>
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                  {app.financeAccounts.map(acc => {
                    const typeDef = ACCOUNT_TYPES.find(t => t.value === acc.type);
                    return (
                      <div key={acc.id} className="card" style={{ borderLeft: `3px solid ${acc.color}` }}>
                        <div className="card-header">
                          <div>
                            <h3 className="card-title">{acc.icon} {acc.name}</h3>
                            <div className="card-subtitle">{typeDef?.label}</div>
                          </div>
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: acc.balance < 0 ? '#ff6b6b' : '#e1e4ea', margin: '8px 0' }}>{formatGBP(acc.balance)}</div>
                        <div className="actions-row">
                          <button className="btn btn-secondary btn-sm" onClick={() => openEditAcc(acc)}>Edit</button>
                          {deletingId === acc.id ? (
                            <div className="confirm-bar" role="alert" style={{ margin: 0 }}>
                              Delete account + transactions?
                              <button className="btn btn-danger btn-sm" onClick={() => { app.removeFinanceAccount(acc.id); setDeletingId(null); }}>Yes</button>
                              <button className="btn btn-secondary btn-sm" onClick={() => setDeletingId(null)}>No</button>
                            </div>
                          ) : (
                            <button className="btn btn-danger btn-sm" onClick={() => setDeletingId(acc.id)}>Remove</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 16, padding: '12px 0', borderTop: '1px solid #1e2030', fontSize: 14, fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Net Worth</span>
                  <span style={{ color: netWorth >= 0 ? '#22c55e' : '#ff6b6b' }}>{formatGBP(netWorth)}</span>
                </div>
              </>
            )}
          </>
        )}

        {/* ══ Budgets & Goals ══ */}
        {tab === 'budgets' && (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Monthly Budgets</h3>
            {app.financeBudgets.length === 0 ? (
              <div className="empty-state" role="status" style={{ padding: '30px 16px' }}>
                <h3 style={{ fontSize: 13 }}>No budgets</h3>
                <p style={{ fontSize: 12 }}>Set monthly spending limits per category.</p>
                <button className="btn btn-primary btn-sm" onClick={() => setShowBudgetForm(true)}>+ Add Budget</button>
              </div>
            ) : (
              <>
                {app.financeBudgets.map(b => {
                  const spent = categorySpend(app.transactions, b.category, currentMonth);
                  const pct = b.monthlyLimit > 0 ? (spent / b.monthlyLimit) * 100 : 0;
                  const cat = getCategoryDef(b.category);
                  return (
                    <div key={b.id} className="finance-budget-row" style={{ marginBottom: 6 }}>
                      <span className="finance-budget-label">{cat.icon} {cat.label}</span>
                      <div className="finance-budget-bar-wrap">
                        <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, pct)}%`, background: pct > 90 ? '#ff6b6b' : pct > 75 ? '#f59e0b' : '#4f5bff' }} /></div>
                      </div>
                      <span className="finance-budget-values">{formatGBP(spent)} / {formatGBP(b.monthlyLimit)}</span>
                      <button className="btn-icon btn-sm" onClick={() => { app.removeFinanceBudget(b.id); }} style={{ color: '#ff6b6b', fontSize: 11 }}>&times;</button>
                    </div>
                  );
                })}
                <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setShowBudgetForm(true)}>+ Add Budget</button>
              </>
            )}

            <h3 style={{ fontSize: 14, fontWeight: 600, margin: '24px 0 12px' }}>Savings Goals</h3>
            {app.savingsGoals.length === 0 ? (
              <div className="empty-state" role="status" style={{ padding: '30px 16px' }}>
                <h3 style={{ fontSize: 13 }}>No savings goals</h3>
                <p style={{ fontSize: 12 }}>Set targets to save towards.</p>
                <button className="btn btn-primary btn-sm" onClick={() => setShowGoalForm(true)}>+ Add Goal</button>
              </div>
            ) : (
              <>
                {app.savingsGoals.map(g => {
                  const pct = g.targetAmount > 0 ? (g.currentAmount / g.targetAmount) * 100 : 0;
                  return (
                    <div key={g.id} className="goal-card" style={{ marginBottom: 10 }}>
                      <div className="goal-title">{g.icon} {g.name}</div>
                      <div className="gam-xp-bar" style={{ height: 8, margin: '6px 0' }}>
                        <div className="gam-xp-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <div style={{ fontSize: 12, color: '#9499b0' }}>{formatGBP(g.currentAmount)} / {formatGBP(g.targetAmount)} ({Math.round(pct)}%){g.deadline && ` \u00b7 Target: ${g.deadline}`}</div>
                      <div className="actions-row" style={{ marginTop: 8 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => {
                          const input = prompt('Current amount (\u00a3):', (g.currentAmount / 100).toFixed(2));
                          if (input) app.updateSavingsGoal(g.id, { currentAmount: parseToPence(input) });
                        }}>Update</button>
                        <button className="btn btn-danger btn-sm" onClick={() => app.removeSavingsGoal(g.id)}>Remove</button>
                      </div>
                    </div>
                  );
                })}
                <button className="btn btn-secondary btn-sm" onClick={() => setShowGoalForm(true)}>+ Add Goal</button>
              </>
            )}
          </>
        )}
      </div>

      {/* Account Modal */}
      {showAccForm && (
        <div className="modal-overlay" onClick={() => setShowAccForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={editingAcc ? 'Edit Account' : 'Add Account'}>
            <h2>{editingAcc ? 'Edit Account' : 'Add Account'}</h2>
            <div className="form-group">
              <label htmlFor="fin-acc-name">Account Name</label>
              <input id="fin-acc-name" className="form-input" value={accName} onChange={e => setAccName(e.target.value)} placeholder="e.g., Barclays Current" autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="fin-acc-type">Type</label>
              <select id="fin-acc-type" className="form-select" value={accType} onChange={e => setAccType(e.target.value as FinanceAccountType)}>
                {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="fin-acc-balance">{editingAcc ? 'Current Balance' : 'Starting Balance'} (\u00a3)</label>
              <input id="fin-acc-balance" className="form-input" type="number" step="0.01" value={accBalance} onChange={e => setAccBalance(e.target.value)} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label>Color</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {ACCOUNT_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setAccColor(c)} style={{ width: 24, height: 24, borderRadius: 4, background: c, border: accColor === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowAccForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAcc} disabled={!accName.trim()}>{editingAcc ? 'Save' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Budget Modal */}
      {showBudgetForm && (
        <div className="modal-overlay" onClick={() => setShowBudgetForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add Budget">
            <h2>Add Monthly Budget</h2>
            <div className="form-group">
              <label htmlFor="fin-budget-cat">Category</label>
              <select id="fin-budget-cat" className="form-select" value={budgetCat} onChange={e => setBudgetCat(e.target.value as ExpenseCategory)}>
                {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="fin-budget-limit">Monthly Limit (\u00a3)</label>
              <input id="fin-budget-limit" className="form-input" type="number" step="0.01" value={budgetLimit} onChange={e => setBudgetLimit(e.target.value)} placeholder="500.00" autoFocus />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowBudgetForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { if (budgetLimit) { app.addFinanceBudget({ category: budgetCat, monthlyLimit: parseToPence(budgetLimit) }); setShowBudgetForm(false); setBudgetLimit(''); } }} disabled={!budgetLimit}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Goal Modal */}
      {showGoalForm && (
        <div className="modal-overlay" onClick={() => setShowGoalForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add Savings Goal">
            <h2>Add Savings Goal</h2>
            <div className="form-group">
              <label htmlFor="fin-goal-name">Goal Name</label>
              <input id="fin-goal-name" className="form-input" value={goalName} onChange={e => setGoalName(e.target.value)} placeholder="e.g., Emergency Fund" autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="fin-goal-target">Target Amount (\u00a3)</label>
              <input id="fin-goal-target" className="form-input" type="number" step="0.01" value={goalTarget} onChange={e => setGoalTarget(e.target.value)} placeholder="10000.00" />
            </div>
            <div className="form-group">
              <label htmlFor="fin-goal-current">Current Amount (\u00a3)</label>
              <input id="fin-goal-current" className="form-input" type="number" step="0.01" value={goalCurrent} onChange={e => setGoalCurrent(e.target.value)} placeholder="0.00" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowGoalForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => {
                if (goalName.trim() && goalTarget) {
                  app.addSavingsGoal({ name: goalName.trim(), targetAmount: parseToPence(goalTarget), currentAmount: parseToPence(goalCurrent || '0'), icon: goalIcon, completed: false, completedAt: undefined, deadline: undefined, linkedAccountId: undefined });
                  setShowGoalForm(false); setGoalName(''); setGoalTarget(''); setGoalCurrent('');
                }
              }} disabled={!goalName.trim() || !goalTarget}>Add</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
