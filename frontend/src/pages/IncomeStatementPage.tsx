import { useEffect, useState } from "react";
import { getIncomeStatementHistory, IncomeStatementRecord, getTransactions, TransactionRecord } from "../services/api";
import { Link } from "react-router-dom";
import { BarChart, Bar, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";

const INCOME_COLORS = ["#10b981", "#f59e0b", "#64748b"];
const EXPENSE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#64748b"];

export default function IncomeStatementPage() {
  const [history, setHistory] = useState<IncomeStatementRecord[]>([]);
  const [viewMode, setViewMode] = useState<"month" | "year">("month");

  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d;
  });

  const [recentTxns, setRecentTxns] = useState<TransactionRecord[]>([]);
  const [txnType, setTxnType] = useState<"all" | "income" | "expense">("all");

  useEffect(() => {
    getIncomeStatementHistory().then(setHistory).catch(console.error);
  }, []);

  useEffect(() => {
    const month = viewMode === "year" ? undefined : currentDate.getMonth() + 1;
    getTransactions(currentDate.getFullYear(), month)
      .then(txns => setRecentTxns(txns))
      .catch(console.error);
  }, [currentDate, viewMode]);

  const handlePrev = () => setCurrentDate(d => {
    const nd = new Date(d);
    if (viewMode === "year") {
      nd.setFullYear(d.getFullYear() - 1);
    } else {
      nd.setMonth(d.getMonth() - 1);
    }
    return nd;
  });

  const handleNext = () => setCurrentDate(d => {
    const nd = new Date(d);
    if (viewMode === "year") {
      nd.setFullYear(d.getFullYear() + 1);
    } else {
      nd.setMonth(d.getMonth() + 1);
    }
    return nd;
  });

  const formatPeriodLabel = (d: Date) => {
    return viewMode === "year" ? `${d.getFullYear()}年` : `${d.getFullYear()}年${d.getMonth() + 1}月`;
  };

  const targetYear = currentDate.getFullYear();
  const targetPeriod = `${targetYear}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-01`;

  // Aggregate monthly data for annual view mode
  const annualData = history
    .filter(r => {
      const parts = r.period.split("-");
      return parts.length > 0 && parseInt(parts[0], 10) === targetYear;
    })
    .reduce(
      (acc, r) => {
        acc.total_income += r.total_income;
        acc.total_expenses += r.total_expenses;
        acc.net_savings += r.net_savings;
        acc.salary_income += r.salary_income;
        acc.investment_income += r.investment_income;
        acc.credit_card_expenses += r.credit_card_expenses;
        acc.bank_expenses += r.bank_expenses;
        return acc;
      },
      {
        total_income: 0,
        total_expenses: 0,
        net_savings: 0,
        salary_income: 0,
        investment_income: 0,
        credit_card_expenses: 0,
        bank_expenses: 0,
      }
    );

  const activeRecord = viewMode === "year"
    ? { period: `${targetYear}-01-01`, ...annualData }
    : (history.find(b => b.period === targetPeriod) || null);

  // Map backend category keys → Chinese display names
  const CATEGORY_LABEL: Record<string, string> = {
    SALARY: "薪資", INVESTMENT: "投資", TRANSFER_IN: "轉入", TRANSFER_OUT: "轉出",
    EXPENSE: "生活用品", FOOD: "餐飲美食", TRANSPORT: "交通運輸",
    MEDICAL: "醫療保健", ENTERTAINMENT: "娛樂休閒", INSURANCE: "保險",
    EXERCISE: "運動", SHOPPING: "購物", CREDIT_CARD_PAYMENT: "信用卡繳款", DEBT_REPAYMENT: "本金償還",
    DIVIDEND: "股利", INTEREST: "利息", OTHER: "其他",
    "食物": "餐飲美食", "餐飲": "餐飲美食", "餐飲美食": "餐飲美食",
    "交通": "交通運輸", "醫療": "醫療保健", "娛樂": "娛樂休閒",
    "支出": "生活用品", "生活用品": "生活用品",
    "購物": "購物",
    "other": "其他",
  };

  // Build the permanent set of excluded categories for income statement
  const EXCLUDED_CATEGORIES = (() => {
    const set = new Set<string>();
    set.add("帳內互轉");
    set.add("轉入");
    set.add("轉出");
    set.add("TRANSFER_IN");
    set.add("TRANSFER_OUT");
    set.add("投資");
    set.add("INVESTMENT");
    set.add("信用卡繳款");
    set.add("本金償還");
    set.add("CREDIT_CARD_PAYMENT");
    set.add("DEBT_REPAYMENT");
    return set;
  })();

  // Compute dynamic income categories from recentTxns using the filter
  const incomePieData = (() => {
    if (!recentTxns || recentTxns.length === 0) return [];
    const incomeCategories: Record<string, number> = {};

    recentTxns
      .filter(t => !EXCLUDED_CATEGORIES.has(t.category))
      .filter(t => !t.is_duplicate)
      .filter(t => t.amount > 0)
      .forEach(t => {
        let name = "其他收入";
        if (t.category === "SALARY" || t.category === "薪資") {
          name = "薪資收入";
        } else if (t.category === "INVESTMENT" || t.category === "投資" || t.category === "DIVIDEND" || t.category === "股利") {
          name = "投資收入";
        } else {
          name = CATEGORY_LABEL[t.category] ?? t.category ?? "其他收入";
          if (name === "其他") name = "其他收入";
        }
        incomeCategories[name] = (incomeCategories[name] || 0) + t.amount;
      });

    return Object.entries(incomeCategories)
      .map(([name, value]) => ({ name, value }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value);
  })();

  // Group by standard category based on actual filtered expenses
  const expensePieData = (() => {
    if (!recentTxns || recentTxns.length === 0) return [];
    const expenseCategories: Record<string, number> = {};

    recentTxns
      .filter(t => !EXCLUDED_CATEGORIES.has(t.category))
      .filter(t => !t.is_duplicate)
      .filter(t => t.amount < 0) // Only negative amounts are expenses
      .forEach(t => {
        const amt = Math.abs(t.amount);
        let name = "其他";
        if (t.category === "食物" || t.category === "餐飲" || t.category === "餐飲美食" || t.category === "FOOD") {
          name = "餐飲美食";
        } else if (t.category === "交通" || t.category === "交通運輸" || t.category === "TRANSPORT") {
          name = "交通運輸";
        } else if (t.category === "支出" || t.category === "生活用品" || t.category === "EXPENSE") {
          name = "生活用品";
        } else if (t.category === "娛樂" || t.category === "娛樂休閒" || t.category === "ENTERTAINMENT") {
          name = "娛樂休閒";
        } else if (t.category === "醫療" || t.category === "醫療保健" || t.category === "MEDICAL") {
          name = "醫療保健";
        } else if (t.category === "保險" || t.category === "INSURANCE") {
          name = "保險";
        } else if (t.category === "運動" || t.category === "EXERCISE") {
          name = "運動";
        } else if (t.category === "購物" || t.category === "SHOPPING") {
          name = "購物";
        } else {
          name = CATEGORY_LABEL[t.category] ?? t.category ?? "其他";
        }
        expenseCategories[name] = (expenseCategories[name] || 0) + amt;
      });

    return Object.entries(expenseCategories)
      .map(([name, value]) => ({ name, value }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  })();

  // Calculate dynamic total income and expenses from the filtered lists
  const displayTotalIncome = incomePieData.reduce((sum, d) => sum + d.value, 0);
  const displayTotalExpenses = expensePieData.reduce((sum, d) => sum + d.value, 0);

  const handleExport = () => {
    const year = currentDate.getFullYear();
    const month = viewMode === "month" ? currentDate.getMonth() + 1 : "";
    const baseUrl = import.meta.env.VITE_API_URL || "/api/v1";
    const url = `${baseUrl}/income-statement/export?year=${year}${month ? `&month=${month}` : ""}`;
    window.open(url, "_blank");
  };

  return (
    <div className="animate-in fade-in duration-500">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">損益表</h1>
          <p className="text-sm text-slate-500 mt-1">掌握你的收入與支出狀況</p>
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm text-sm font-bold text-slate-700">
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handlePrev}>{"<"}</span>
            {formatPeriodLabel(currentDate)}
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handleNext}>{">"}</span>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button 
              onClick={() => setViewMode("month")}
              className={`rounded px-3 py-1 text-sm font-bold transition-colors ${
                viewMode === "month" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              月視圖
            </button>
            <button 
              onClick={() => setViewMode("year")}
              className={`rounded px-3 py-1 text-sm font-bold transition-colors ${
                viewMode === "year" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              年視圖
            </button>
          </div>
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            匯出 Excel
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-6 mb-6">
        {[
          { label: "總收入", val: displayTotalIncome },
          { label: "總支出", val: displayTotalExpenses },
          { label: viewMode === "year" ? "本年結餘" : "本月結餘", val: displayTotalIncome - displayTotalExpenses },
          { label: "儲蓄率", val: displayTotalIncome > 0 ? (((displayTotalIncome - displayTotalExpenses) / displayTotalIncome) * 100) : 0, isPercent: true },
        ].map((k, i) => (
          <div key={i} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="text-sm font-bold text-slate-500 mb-2">{k.label}</div>
            <div className="text-2xl font-bold text-slate-900 mb-3">
              {k.isPercent ? `${k.val.toFixed(1)}%` : `$${k.val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            </div>
          </div>
        ))}
      </div>

      {/* Donut Charts */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        
        {/* Income Bar Chart (Redesigned) */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-slate-800">收入明細</h3>
            {activeRecord && (
              <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                {viewMode === "year" ? "年總收入" : "總收入"}: ${displayTotalIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            )}
          </div>
          <div className="flex-1 flex items-center justify-between">
            <div className="w-[200px] h-[200px] relative">
              {incomePieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={incomePieData} layout="vertical" margin={{ left: -10, right: 10, top: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#475569', fontWeight: 'bold' }} width={80} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      formatter={(value: number) => [`$${value.toLocaleString()}`, "收入金額"]}
                    />
                    <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={16}>
                      {incomePieData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={INCOME_COLORS[index % INCOME_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full border-2 border-slate-100 rounded-2xl border-dashed flex items-center justify-center text-slate-300 text-sm">無資料</div>
              )}
            </div>
            
            <div className="flex-1 pl-8 space-y-4">
              {incomePieData.map((d, i) => (
                <div key={i} className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: INCOME_COLORS[i % INCOME_COLORS.length] }} />
                    <span className="text-slate-600 font-medium w-16">{d.name}</span>
                    <span className="text-slate-400 font-bold">{Math.round((d.value / (displayTotalIncome || 1)) * 100)}%</span>
                  </div>
                  <span className="text-slate-800 font-bold">${d.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Expense Bar Chart (Redesigned) */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-slate-800">支出分類明細</h3>
            {activeRecord && (
              <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                {viewMode === "year" ? "年總支出" : "總支出"}: ${displayTotalExpenses.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            )}
          </div>
          <div className="flex-1 flex items-center justify-between">
            <div className="w-[200px] h-[200px] relative">
              {expensePieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={expensePieData} layout="vertical" margin={{ left: -10, right: 10, top: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#475569', fontWeight: 'bold' }} width={80} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      formatter={(value: number) => [`$${value.toLocaleString()}`, "支出金額"]}
                    />
                    <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={14}>
                      {expensePieData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={EXPENSE_COLORS[index % EXPENSE_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full border-2 border-slate-100 rounded-2xl border-dashed flex items-center justify-center text-slate-300 text-sm">無資料</div>
              )}
            </div>
            
            <div className="flex-1 pl-8 space-y-3">
              {expensePieData.map((d, i) => (
                <div key={i} className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: EXPENSE_COLORS[i % EXPENSE_COLORS.length] }} />
                    <span className="text-slate-600 font-medium w-10">{d.name}</span>
                    <span className="text-slate-400 font-bold">{Math.round((d.value / (displayTotalExpenses || 1)) * 100)}%</span>
                  </div>
                  <span className="text-slate-800 font-bold">${d.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* Transaction List */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-6">
            <h3 className="font-bold text-slate-800">收支明細 (依日期)</h3>
            <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs">
              <button 
                onClick={() => setTxnType("all")}
                className={`rounded px-2.5 py-1 font-bold transition-colors cursor-pointer ${
                  txnType === "all" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                全部
              </button>
              <button 
                onClick={() => setTxnType("income")}
                className={`rounded px-2.5 py-1 font-bold transition-colors cursor-pointer ${
                  txnType === "income" ? "bg-white text-green-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                收入
              </button>
              <button 
                onClick={() => setTxnType("expense")}
                className={`rounded px-2.5 py-1 font-bold transition-colors cursor-pointer ${
                  txnType === "expense" ? "bg-white text-red-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                支出
              </button>
            </div>
          </div>
          <Link to={`/transactions?year=${currentDate.getFullYear()}&month=${currentDate.getMonth() + 1}${txnType !== "all" ? `&type=${txnType}` : ""}`} className="text-blue-600 text-sm font-bold hover:text-blue-700 transition-colors">查看全部交易 ➔</Link>
        </div>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">日期</th>
                <th className="px-6 py-4">項目</th>
                <th className="px-6 py-4">分類</th>
                <th className="px-6 py-4 text-right">金額</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(() => {
                const filtered = recentTxns
                  .filter(t => !EXCLUDED_CATEGORIES.has(t.category))
                  .filter(t => !t.is_duplicate)
                  .filter(t => {
                    if (txnType === "income") return t.amount > 0;
                    if (txnType === "expense") return t.amount < 0;
                    return true;
                  })
                  .slice(0, 5);
                return filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-slate-500">暫無交易紀錄</td>
                  </tr>
                ) : (
                  filtered.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-slate-500">{t.date}</td>
                      <td className="px-6 py-4 font-medium text-slate-800">{t.description || t.merchant || "-"}</td>
                      <td className="px-6 py-4 text-slate-500">{t.raw_category || t.category || "-"}</td>
                      <td className={`px-6 py-4 text-right font-bold ${t.amount < 0 ? "text-slate-800" : "text-green-600"}`}>
                        {t.amount < 0 ? `$${Math.abs(t.amount).toLocaleString()}` : `+ $${t.amount.toLocaleString()}`}
                      </td>
                    </tr>
                  ))
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
