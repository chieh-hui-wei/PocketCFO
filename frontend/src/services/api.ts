// frontend/src/services/api.ts
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "/api/v1",
  timeout: 120_000, // PDF parsing can take time (increased to 2 min to prevent timeout)
});

// Interceptor to strip leading slash from relative paths to preserve the baseURL sub-path
api.interceptors.request.use((config) => {
  if (config.url && config.url.startsWith("/")) {
    config.url = config.url.substring(1);
  }
  return config;
});

// ── Uploads ──────────────────────────────────────────────────────────────────

export type StatementKind = "bank" | "credit_card" | "brokerage" | "einvoice";

export async function uploadStatement(
  file: File,
  kind: StatementKind,
  accountCode?: string,
  password?: string
) {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  if (accountCode) form.append("account_code", accountCode);
  if (password) form.append("password", password);
  const { data } = await api.post("/upload/statement", form);
  return data;
}

export type UploadHistoryRecord = {
  id: number;
  filename: string;
  kind: string;
  status: string;
  message: string | null;
  created_at: string;
};

export async function getUploadHistory() {
  const { data } = await api.get("/upload/history");
  return data as UploadHistoryRecord[];
}

export async function deleteUploadHistory(id: number) {
  const { data } = await api.delete(`/upload/history/${id}`);
  return data;
}

// ── Balance Sheet ────────────────────────────────────────────────────────────

export async function getBalanceSheetHistory() {
  const { data } = await api.get("/balance-sheet/");
  return data as BalanceSheetRecord[];
}

export async function computeBalanceSheet(year: number, month: number) {
  const { data } = await api.post("/balance-sheet/compute", null, {
    params: { year, month },
  });
  return data;
}

export async function syncBrokerData(year: number, month: number) {
  const { data } = await api.post("/balance-sheet/sync-broker", null, {
    params: { year, month },
  });
  return data;
}

// ── Income Statement ─────────────────────────────────────────────────────────

export async function getIncomeStatementHistory() {
  const { data } = await api.get("/income-statement/");
  return data as IncomeStatementRecord[];
}

export async function computeIncomeStatement(year: number, month: number) {
  const { data } = await api.post("/income-statement/compute", null, {
    params: { year, month },
  });
  return data;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export async function getAccounts() {
  const { data } = await api.get("/accounts/");
  return data as Account[];
}

export async function createAccount(
  name: string,
  type: string,
  institution: string,
  currency: string = "TWD",
  code?: string
) {
  const { data } = await api.post("/accounts/", {
    name,
    account_type: type,
    institution,
    currency,
    code,
  });
  return data;
}

export interface AccountWithSnapshot extends Account {
  balance: number | null;
  has_snapshot: boolean;
  snapshot_source: string | null;
}

export async function getAccountsWithSnapshots(year: number, month: number) {
  const { data } = await api.get("/accounts/snapshots", {
    params: { year, month },
  });
  return data as AccountWithSnapshot[];
}

export async function saveAccountSnapshot(
  accountId: number,
  periodDate: string,
  balance: number
) {
  const { data } = await api.post(`/accounts/${accountId}/snapshots`, {
    period_date: periodDate,
    balance,
  });
  return data;
}

export async function deleteAccountSnapshot(
  accountId: number,
  periodDate: string
) {
  const { data } = await api.delete(`/accounts/${accountId}/snapshots/${periodDate}`);
  return data;
}


// ── Types ────────────────────────────────────────────────────────────────────

export interface BalanceSheetRecord {
  period: string;
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
  total_cash: number;
  total_securities_market_value: number;
  detail?: any;
}

export interface IncomeStatementRecord {
  period: string;
  total_income: number;
  total_expenses: number;
  net_savings: number;
  salary_income: number;
  investment_income: number;
  credit_card_expenses: number;
  bank_expenses: number;
}

export interface Account {
  id: number;
  code: string;
  name: string;
  type: string;
  institution: string;
  currency: string;
  is_internal: boolean;
}

// ── Transactions ─────────────────────────────────────────────────────────────

export interface TransactionRecord {
  id: number;
  date: string;
  source: string;
  merchant: string;
  description: string;
  amount: number;
  category: string;
  is_refund: boolean;
  raw_category: string | null;
  institution?: string;
}

export async function getTransactions(year: number, month?: number) {
  const { data } = await api.get("/transactions/", { params: { year, month } });
  return data.transactions as TransactionRecord[];
}

export async function getStockTransactions(year: number, month: number) {
  const { data } = await api.get("/transactions/stocks", { params: { year, month } });
  return data.transactions as TransactionRecord[];
}

// ── Securities ───────────────────────────────────────────────────────────────

export interface SecurityRecord {
  id?: number;
  account_id: number;
  account_name?: string;
  period_date: string;
  ticker: string;
  name: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  original_avg_cost?: number;
  original_current_price?: number;
  original_market_value?: number;
  original_unrealized_pnl?: number;
  currency?: string;
  exchange_rate?: number;
}

export async function getSecuritiesForPeriod(year: number, month: number) {
  const { data } = await api.get("/accounts/securities", {
    params: { year, month }
  });
  return data as SecurityRecord[];
}

export async function saveSecuritiesForAccount(
  accountId: number,
  periodDate: string,
  securities: Array<{
    ticker: string;
    name?: string;
    quantity: number;
    avg_cost?: number;
    current_price?: number;
  }>
) {
  const { data } = await api.post(`/accounts/${accountId}/securities`, {
    securities
  }, {
    params: { period_date: periodDate }
  });
  return data;
}

export interface StockTransactionsSummaryItem {
  period: string;
  month_label: string;
  buys: number;
  sells: number;
  net: number;
  count: number;
}

export async function getStockTransactionsSummary(months: number = 6) {
  const { data } = await api.get("/transactions/stocks/summary", {
    params: { months }
  });
  return data.summary as StockTransactionsSummaryItem[];
}

export async function getSecuritiesHistory() {
  const { data } = await api.get("/accounts/securities/history");
  return data as SecurityRecord[];
}

export async function parseStatement(
  file: File,
  kind: StatementKind,
  accountCode?: string,
  password?: string
) {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  if (accountCode) form.append("account_code", accountCode);
  if (password) form.append("password", password);
  const { data } = await api.post("/upload/parse", form);
  return data;
}

export async function confirmStatement(payload: any) {
  const { data } = await api.post("/upload/confirm", payload);
  return data;
}

export async function updateTransaction(
  txnId: number,
  payload: {
    date?: string;
    merchant?: string;
    description?: string;
    amount?: number;
    category?: string;
  }
) {
  const { data } = await api.put(`/transactions/${txnId}`, payload);
  return data;
}

export async function deleteTransaction(txnId: number) {
  const { data } = await api.delete(`/transactions/${txnId}`);
  return data;
}

// ── Account Settings / Management ──────────────────────────────────────────

export async function updateAccount(
  accountId: number,
  payload: {
    name?: string;
    account_type?: string;
    institution?: string;
    currency?: string;
    is_internal?: boolean;
    code?: string;
    notes?: string;
  }
) {
  const { data } = await api.put(`/accounts/${accountId}`, payload);
  return data;
}

export async function deleteAccount(accountId: number) {
  const { data } = await api.delete(`/accounts/${accountId}`);
  return data;
}

// ── App Settings ───────────────────────────────────────────────────────────

export interface CredentialsSettings {
  gemini_api_key: string;
  gemini_model: string;
  esun_account: string;
  esun_api_key: string;
  has_esun_password?: boolean;
  has_esun_cert_password?: boolean;
  taishin_account_id: string;
  taishin_api_key: string;
  has_taishin_cert_password?: boolean;
  sinopac_account_id: string;
  sinopac_api_key: string;
  has_sinopac_cert_password?: boolean;
  cert_statuses: {
    taishin: boolean;
    sinopac: boolean;
    esun: boolean;
  };
}

export async function getSettings() {
  const { data } = await api.get("/settings/");
  return data as CredentialsSettings;
}

export async function saveSettings(payload: {
  gemini_api_key?: string;
  esun_account?: string;
  esun_password?: string;
  esun_cert_password?: string;
  esun_api_key?: string;
  esun_api_secret?: string;
  taishin_account_id?: string;
  taishin_api_key?: string;
  taishin_api_secret?: string;
  taishin_cert_password?: string;
  sinopac_account_id?: string;
  sinopac_api_key?: string;
  sinopac_api_secret?: string;
  sinopac_cert_password?: string;
}) {
  const { data } = await api.post("/settings/credentials", payload);
  return data;
}

export async function uploadCertificate(file: File, broker: "taishin" | "sinopac" | "esun") {
  const form = new FormData();
  form.append("file", file);
  form.append("broker", broker);
  const { data } = await api.post("/settings/upload-cert", form);
  return data;
}


