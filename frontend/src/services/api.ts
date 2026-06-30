// frontend/src/services/api.ts
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api/v1",
  timeout: 120_000, // PDF parsing can take time (increased to 2 min to prevent timeout)
});

// Interceptor to strip leading slash and inject JWT token
api.interceptors.request.use((config) => {
  if (config.url && config.url.startsWith("/")) {
    config.url = config.url.substring(1);
  }
  const token = localStorage.getItem("pocketcfo_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Caching system for GET requests
const cache: Record<string, { data: any; expiry: number }> = {};
const CACHE_TTL = 30_000; // 30 seconds Cache Time-To-Live

async function fetchWithCache(url: string, params?: any) {
  const cacheKey = url + (params ? JSON.stringify(params) : "");
  const now = Date.now();
  if (cache[cacheKey] && cache[cacheKey].expiry > now) {
    return cache[cacheKey].data;
  }
  const data = await api.get(url, { params }).then(res => res.data);
  cache[cacheKey] = { data, expiry: now + CACHE_TTL };
  return data;
}

export function clearApiCache() {
  for (const key in cache) {
    delete cache[key];
  }
}

// Clear cache automatically on mutations and handle unauthorized access
api.interceptors.response.use(
  (response) => {
    if (response.config.method && response.config.method.toLowerCase() !== "get") {
      clearApiCache();
    }
    return response;
  },
  (error) => {
    if (error.config && error.config.method && error.config.method.toLowerCase() !== "get") {
      clearApiCache();
    }
    if (error.response && error.response.status === 401) {
      // Don't auto-redirect if we are already trying to login
      if (error.config && !error.config.url.includes("/auth/login")) {
        localStorage.removeItem("pocketcfo_token");
        window.dispatchEvent(new Event("pocketcfo_unauthorized"));
      }
    }
    return Promise.reject(error);
  }
);

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
  const data = await fetchWithCache("/upload/history");
  return data as UploadHistoryRecord[];
}

export async function deleteUploadHistory(id: number) {
  const { data } = await api.delete(`/upload/history/${id}`);
  return data;
}

// ── Balance Sheet ────────────────────────────────────────────────────────────

export async function getBalanceSheetHistory() {
  const data = await fetchWithCache("/balance-sheet/");
  console.log("getBalanceSheetHistory data:", typeof data, Array.isArray(data), data);
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
  const data = await fetchWithCache("/income-statement/");
  console.log("getIncomeStatementHistory data:", typeof data, Array.isArray(data), data);
  return data as IncomeStatementRecord[];
}

export async function computeIncomeStatement(year: number, month: number) {
  const { data } = await api.post("/income-statement/compute", null, {
    params: { year, month },
  });
  return data;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export async function getAccounts(includeAll?: boolean) {
  const data = await fetchWithCache("/accounts/", { include_all: includeAll });
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
  const data = await fetchWithCache("/accounts/snapshots", { year, month });
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
  const data = await fetchWithCache("/transactions/", { year, month });
  console.log("getTransactions data:", typeof data, data);
  return data.transactions as TransactionRecord[];
}

export async function getStockTransactions(year: number, month: number) {
  const data = await fetchWithCache("/transactions/stocks", { year, month });
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
  const data = await fetchWithCache("/accounts/securities", { year, month });
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
  const data = await fetchWithCache("/transactions/stocks/summary", { months });
  return data.summary as StockTransactionsSummaryItem[];
}

export async function getSecuritiesHistory() {
  const data = await fetchWithCache("/accounts/securities/history");
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

export async function createTransaction(payload: {
  date: string;
  description: string;
  amount: number;
  category: string;
  source: string;
  merchant?: string;
  account_id?: number | null;
}) {
  const { data } = await api.post("/transactions/", payload);
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
  const data = await fetchWithCache("/settings/");
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

export async function testConnection(broker: "taishin" | "sinopac" | "esun" | "gemini") {
  const { data } = await api.post("/settings/test-connection", { broker });
  return data;
}

export async function login(email: string, password: string) {
  const { data } = await api.post("/auth/login", { email, password });
  if (data.token) {
    localStorage.setItem("pocketcfo_token", data.token);
    if (data.user) {
      localStorage.setItem("pocketcfo_user", JSON.stringify(data.user));
    }
  }
  return data;
}

export async function inviteFriend(email: string) {
  const { data } = await api.post("/auth/invite", { email });
  return data;
}

export async function registerUser(email: string, password: string, pinCode: string) {
  const { data } = await api.post("/auth/register", {
    email,
    password,
    pin_code: pinCode,
  });
  return data;
}

export async function updateProfile(email?: string, password?: string) {
  const { data } = await api.put("/auth/profile", { email, password });
  if (data.user) {
    localStorage.setItem("pocketcfo_user", JSON.stringify(data.user));
  }
  return data;
}

export async function forgotPassword(email: string) {
  const { data } = await api.post("/auth/forgot-password", { email });
  return data;
}

export async function resetPassword(email: string, pinCode: string, newPassword: string) {
  const { data } = await api.post("/auth/reset-password", {
    email,
    pin_code: pinCode,
    new_password: newPassword,
  });
  return data;
}




