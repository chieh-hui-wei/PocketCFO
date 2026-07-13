import React, { useEffect, useState } from "react";
import { 
  getBalanceSheetHistory, 
  BalanceSheetRecord,
  AccountWithSnapshot,
  createAccount,
  getAccountsWithSnapshots,
  saveAccountSnapshot,
  deleteAccountSnapshot
} from "../services/api";
import { LineChart, Line, ResponsiveContainer, BarChart, Bar, Cell, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { toast } from "../store/useToastStore";



export default function BalanceSheetPage() {
  const [history, setHistory] = useState<BalanceSheetRecord[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountWithSnapshot[]>([]);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  
  // New account form state
  const [newAccName, setNewAccName] = useState("");
  const [newAccType, setNewAccType] = useState("liability");
  const [newAccInst, setNewAccInst] = useState("");

  // Snapshot balances state being edited
  const [editBalances, setEditBalances] = useState<Record<number, string>>({});

  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d;
  });

  const fetchHistory = () => {
    getBalanceSheetHistory().then(setHistory).catch(console.error);
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const [allDbAccounts, setAllDbAccounts] = useState<any[]>([]);
  useEffect(() => {
    // Fetch all active accounts once
    getAccountsWithSnapshots(currentDate.getFullYear(), currentDate.getMonth() + 1)
      .then(setAllDbAccounts)
      .catch(console.error);
  }, [currentDate]);

  const targetPeriod = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-01`;

  // Filter accounts that are active bank or credit cards but don't have snapshots for the current target period
  const missingAccounts = allDbAccounts
    .filter(a => (a.type === 'bank' || a.type === 'credit_card') && !a.has_snapshot)
    .map(a => a.name);

  const fetchSnapshots = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    getAccountsWithSnapshots(year, month)
      .then(data => {
        setAccounts(data);
        // Initialize editing state
        const balances: Record<number, string> = {};
        data.forEach(acc => {
          balances[acc.id] = acc.balance !== null ? String(Math.abs(acc.balance)) : "";
        });
        setEditBalances(balances);
      })
      .catch(console.error);
  };

  useEffect(() => {
    if (isModalOpen) {
      fetchSnapshots();
    }
  }, [isModalOpen, currentDate]);

  const handlePrevMonth = () => setCurrentDate(d => { const nd = new Date(d); nd.setMonth(d.getMonth() - 1); return nd; });
  const handleNextMonth = () => setCurrentDate(d => { const nd = new Date(d); nd.setMonth(d.getMonth() + 1); return nd; });
  const formatMonth = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月`;

  const latestBs = history.find(b => b.period === targetPeriod) || null;

  const getGrowthRateInfo = () => {
    if (!latestBs) return { text: "— vs 上月", isPositive: true };
    const prevMonthDate = new Date(currentDate);
    prevMonthDate.setMonth(currentDate.getMonth() - 1);
    const prevPeriod = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
    const prevBs = history.find(b => b.period === prevPeriod) || null;

    if (!prevBs || prevBs.net_worth === 0) return { text: "— vs 上月", isPositive: true };
    const diff = latestBs.net_worth - prevBs.net_worth;
    const rate = (diff / Math.abs(prevBs.net_worth)) * 100;
    const sign = rate >= 0 ? "▲" : "▼";
    return {
      text: `${sign} ${Math.abs(rate).toFixed(1)}% vs 上月`,
      isPositive: rate >= 0
    };
  };

  const growthInfo = getGrowthRateInfo();

  const trendData = [...history].reverse().map(b => ({
    name: b.period.split("-")[1] + "月",
    value: b.net_worth
  }));

  const finalTrendData = trendData.length > 0 ? trendData : [];

  // Colors for charts
  const CASH_COLORS = ["#3b82f6", "#06b6d4", "#2563eb", "#0d9488", "#0284c7", "#34d399"];
  const INVEST_COLORS = ["#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#84cc16", "#a78bfa", "#f43f5e"];
  const LIAB_COLORS = ["#ef4444", "#f97316", "#f43f5e", "#d97706", "#b91c1c"];

  // 1. Cash & Deposits Data
  const cashDepositsData: Array<{ name: string, value: number }> = [];
  if (latestBs?.detail) {
    if (latestBs.detail.cash) {
      latestBs.detail.cash.forEach((c: any) => {
        if (c.balance > 0) cashDepositsData.push({ name: c.name, value: c.balance });
      });
    }
    if (latestBs.detail.brokerage_cash) {
      latestBs.detail.brokerage_cash.forEach((c: any) => {
        if (c.balance > 0) cashDepositsData.push({ name: `${c.name} (證券現金)`, value: c.balance });
      });
    }
  }
  cashDepositsData.sort((a, b) => b.value - a.value);

  // 2. Investments Data (Securities by Ticker)
  const investmentsData: Array<{ name: string, value: number }> = [];
  if (latestBs?.detail) {
    if (latestBs.detail.securities) {
      latestBs.detail.securities.forEach((s: any) => {
        const name = `${s.broker || ""} ${s.ticker || s.name || "其他股票"}`;
        if (s.market_value > 0) {
          investmentsData.push({ name: name.trim(), value: s.market_value });
        }
      });
    }
  }
  investmentsData.sort((a, b) => b.value - a.value);

  // 3. Individual Liabilities Data
  const liabDetailData: Array<{ name: string, value: number }> = [];
  if (latestBs?.detail) {
    if (latestBs.detail.credit_cards) {
      latestBs.detail.credit_cards.forEach((cc: any) => {
        if (cc.payable > 0) liabDetailData.push({ name: cc.name, value: cc.payable });
      });
    }
    if (latestBs.detail.liabilities) {
      latestBs.detail.liabilities.forEach((l: any) => {
        if (l.balance > 0) liabDetailData.push({ name: l.name, value: l.balance });
      });
    }
  }
  liabDetailData.sort((a, b) => b.value - a.value);

  const handleSaveBalances = async () => {
    try {
      for (const acc of accounts) {
        const valStr = editBalances[acc.id];
        if (valStr === undefined) continue;
        
        if (valStr.trim() === "") {
          if (acc.has_snapshot) {
            await deleteAccountSnapshot(acc.id, targetPeriod);
          }
        } else {
          const val = parseFloat(valStr);
          if (!isNaN(val)) {
            await saveAccountSnapshot(acc.id, targetPeriod, val);
          }
        }
      }
      fetchHistory();
      setIsModalOpen(false);
    } catch (err) {
      console.error(err);
      toast.error("儲存失敗");
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccName || !newAccInst) return;
    try {
      await createAccount(newAccName, newAccType, newAccInst);
      setNewAccName("");
      setNewAccInst("");
      setIsAddingAccount(false);
      fetchSnapshots();
    } catch (err) {
      console.error(err);
      toast.error("新增帳戶失敗");
    }
  };

  return (
    <div className="animate-in fade-in duration-500">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">資產負債表</h1>
          <p className="text-sm text-slate-500 mt-1">了解你的財務狀況與資產負債結構</p>
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm text-sm font-bold text-slate-700">
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handlePrevMonth}>{"<"}</span>
            {formatMonth(currentDate)}
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handleNextMonth}>{">"}</span>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg border border-blue-700 shadow-sm text-sm font-bold hover:bg-blue-700 transition-colors"
          >
            手動調整金額
          </button>
        </div>
      </div>

      {/* Missing statement warnings */}
      {missingAccounts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
          <span className="text-lg">⚠️</span>
          <div className="text-xs text-amber-800 leading-relaxed">
            <span className="font-bold">未上傳對帳單提醒：</span>
            您目前查看的 {currentDate.getFullYear()} 年 {currentDate.getMonth() + 1} 月數據中，尚未上傳
            <span className="font-bold text-amber-900 mx-1">{missingAccounts.join("、")}</span>
            的對帳單或未登錄餘額（系統暫以 $0 計算，不自動承接上月餘額）。請至
            <a href="/upload" className="text-blue-600 font-bold underline mx-1 hover:text-blue-700">「上傳對帳單」</a>
            或點選右上方手動調整金額以利補齊。
          </div>
        </div>
      )}

      {/* Top Cards (3 Pillars) */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        
        {/* Assets */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col">
          <div className="flex justify-between items-start mb-4">
            <div className="text-sm font-bold text-slate-500">資產總計</div>
          </div>
          <div className="text-3xl font-bold text-slate-900 mb-6">${(latestBs?.total_assets ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          
          <div className="flex-1 space-y-4">
            <div className="flex justify-between text-sm">
              <span className="font-bold text-slate-800">流動資產</span>
              <span className="font-bold text-slate-800">${(latestBs?.total_assets ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between text-sm pl-4">
              <span className="text-slate-500">現金與存款</span>
              <span className="text-slate-700 font-medium">${(latestBs?.total_cash ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between text-sm pl-4">
              <span className="text-slate-500">投資</span>
              <span className="text-slate-700 font-medium">${(latestBs?.total_securities_market_value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          </div>
        </div>

        {/* Liabilities */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col">
          <div className="flex justify-between items-start mb-4">
            <div className="text-sm font-bold text-slate-500">負債總計</div>
          </div>
          <div className="text-3xl font-bold text-slate-900 mb-6">${(latestBs?.total_liabilities ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          
          <div className="flex-1 space-y-4">
            <div className="flex justify-between text-sm">
              <span className="font-bold text-slate-800">流動負債</span>
              <span className="font-bold text-slate-800">${(latestBs?.total_liabilities ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between text-sm pl-4">
              <span className="text-slate-500">信用卡負債</span>
              <span className="text-slate-700 font-medium">
                ${(latestBs?.detail?.credit_cards?.reduce((acc: number, item: any) => acc + item.payable, 0) ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="flex justify-between text-sm pl-4">
              <span className="text-slate-500">分期與其他負債</span>
              <span className="text-slate-700 font-medium">
                ${(latestBs?.detail?.liabilities?.reduce((acc: number, item: any) => acc + item.balance, 0) ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        </div>

        {/* Net Worth */}
        <div className="bg-blue-600 rounded-2xl shadow-md border border-blue-500 p-6 flex flex-col text-white">
          <div className="flex justify-between items-start mb-2">
            <div className="text-sm font-bold text-blue-200">淨資產</div>
          </div>
          <div className="text-3xl font-bold mb-1">${(latestBs?.net_worth ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div className={`text-xs font-bold mb-4 ${growthInfo.isPositive ? 'text-green-300' : 'text-red-300'}`}>
            {growthInfo.text}
          </div>
          
          <div className="flex-1 w-full h-[100px] mt-2">
            {finalTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={finalTrendData}>
                  <Line type="monotone" dataKey="value" stroke="#93c5fd" strokeWidth={3} dot={{ r: 3, fill: '#bfdbfe', strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-blue-300 text-sm border-2 border-blue-400 border-dashed rounded-xl">暫無趨勢資料</div>
            )}
          </div>
        </div>
      </div>

      {/* Analysis Charts Row (Redesigned) */}
      <div className="grid grid-cols-3 gap-6 mb-8">
        
        {/* Chart 1: Cash & Deposits Breakdown */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col h-[400px]">
          <h3 className="font-bold text-slate-800 text-sm mb-4">現金與存款佔比</h3>
          <div className="flex-1 flex items-center justify-center relative min-h-[160px] w-full">
            {cashDepositsData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cashDepositsData} layout="vertical" margin={{ left: -10, right: 10, top: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#475569', fontWeight: 'medium' }} width={85} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [`$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, "現金餘額"]}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={12}>
                    {cashDepositsData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={CASH_COLORS[index % CASH_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-[140px] h-[140px] border-4 border-slate-100 rounded-full border-dashed flex items-center justify-center text-slate-300 text-sm">無資料</div>
            )}
          </div>
          <div className="mt-4 space-y-2 overflow-y-auto max-h-[120px] pr-1 scrollbar-thin">
            {cashDepositsData.map((d: any, i: number) => {
              const total = latestBs?.total_cash || 1;
              return (
                <div key={i} className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CASH_COLORS[i % CASH_COLORS.length] }} />
                    <div className="min-w-0">
                      <span className="text-slate-600 font-medium truncate block">{d.name}</span>
                      {d.currency && d.currency !== 'TWD' && d.original_balance != null && (
                        <span className="text-slate-400 text-[10px]">{d.currency} {d.original_balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-bold text-slate-800">${d.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span className="text-slate-400 text-[10px] ml-1">({Math.round((d.value / total) * 100)}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chart 2: Investments Breakdown */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col h-[400px]">
          <h3 className="font-bold text-slate-800 text-sm mb-4">投資項目各佔比</h3>
          <div className="flex-1 flex items-center justify-center relative min-h-[160px] w-full">
            {investmentsData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={investmentsData} layout="vertical" margin={{ left: -10, right: 10, top: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#475569', fontWeight: 'medium' }} width={85} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [`$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, "投資市值"]}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={12}>
                    {investmentsData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={INVEST_COLORS[index % INVEST_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-[140px] h-[140px] border-4 border-slate-100 rounded-full border-dashed flex items-center justify-center text-slate-300 text-sm">無資料</div>
            )}
          </div>
          <div className="mt-4 space-y-2 overflow-y-auto max-h-[120px] pr-1 scrollbar-thin">
            {investmentsData.map((d, i) => {
              const total = latestBs?.total_securities_market_value || 1;
              return (
                <div key={i} className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: INVEST_COLORS[i % INVEST_COLORS.length] }} />
                    <span className="text-slate-600 font-medium truncate">{d.name}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-bold text-slate-800">${d.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span className="text-slate-400 text-[10px] ml-1">({Math.round((d.value / total) * 100)}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chart 3: Individual Liabilities Breakdown */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col h-[400px]">
          <h3 className="font-bold text-slate-800 text-sm mb-4">負債個別佔比</h3>
          <div className="flex-1 flex items-center justify-center relative min-h-[160px] w-full">
            {liabDetailData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={liabDetailData} layout="vertical" margin={{ left: -10, right: 10, top: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#475569', fontWeight: 'medium' }} width={85} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [`$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, "負債金額"]}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={12}>
                    {liabDetailData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={LIAB_COLORS[index % LIAB_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-[140px] h-[140px] border-4 border-slate-100 rounded-full border-dashed flex items-center justify-center text-slate-300 text-sm">無資料</div>
            )}
          </div>
          <div className="mt-4 space-y-2 overflow-y-auto max-h-[120px] pr-1 scrollbar-thin">
            {liabDetailData.map((d, i) => {
              const total = latestBs?.total_liabilities || 1;
              return (
                <div key={i} className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: LIAB_COLORS[i % LIAB_COLORS.length] }} />
                    <span className="text-slate-600 font-medium truncate">{d.name}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-bold text-slate-800">${d.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span className="text-slate-400 text-[10px] ml-1">({Math.round((d.value / total) * 100)}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>


      {/* Bottom Section - Full Width Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 mb-6">
        <h3 className="font-bold text-slate-800 mb-6">資產負債明細</h3>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">項目</th>
                <th className="px-4 py-3">分組分類</th>
                <th className="px-4 py-3 text-right">本月金額</th>
                <th className="px-4 py-3 text-right">變動金額</th>
                <th className="px-4 py-3 text-right">變動%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-medium text-slate-800">現金與存款</td>
                <td className="px-4 py-3 text-slate-500">流動資產</td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">${(latestBs?.total_cash ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                <td className="px-4 py-3 text-right text-slate-300">-</td>
                <td className="px-4 py-3 text-right text-slate-300">-</td>
              </tr>
              {(() => {
                // Combine bank cash + brokerage cash into one grouped list
                const cashItems: any[] = [
                  ...(latestBs?.detail?.cash?.filter((c: any) => c.balance !== 0) || []),
                  ...(latestBs?.detail?.brokerage_cash?.filter((c: any) => c.balance !== 0)?.map((c: any) => ({
                    ...c, name: `${c.name} (證券現金)`, institution: c.institution || c.name
                  })) || []),
                ];
                // Sort by balance descending
                cashItems.sort((a, b) => b.balance - a.balance);

                return cashItems.map((c: any, i: number) => {
                  const bankLabel = c.institution ? c.institution : "";
                  const displayName = bankLabel ? `${bankLabel} - ${c.name}` : c.name;
                  return (
                    <tr key={`cash-${i}`} className="hover:bg-slate-50 transition-colors bg-slate-50/50">
                      <td className="px-4 py-2 pl-8 text-sm text-slate-600">
                        <span>↳ {displayName}</span>
                        {c.currency && c.currency !== 'TWD' && c.original_balance != null && (
                          <span className="ml-2 text-[11px] text-slate-400">
                            {c.currency} {c.original_balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm text-slate-400">
                        {c.currency && c.currency !== 'TWD' ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200">{c.currency}</span>
                        ) : '子項目'}
                      </td>
                      <td className="px-4 py-2 text-sm text-right text-slate-600">${c.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-2 text-right text-slate-300">-</td>
                      <td className="px-4 py-2 text-right text-slate-300">-</td>
                    </tr>
                  );
                });
              })()}
              
              <tr className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-medium text-slate-800">投資</td>
                <td className="px-4 py-3 text-slate-500">流動資產</td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">${(latestBs?.total_securities_market_value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                <td className="px-4 py-3 text-right text-slate-300">-</td>
                <td className="px-4 py-3 text-right text-slate-300">-</td>
              </tr>
              {latestBs?.detail?.securities?.filter((s: any) => s.market_value !== 0)?.map((s: any, i: number) => (
                <tr key={`sec-${i}`} className="hover:bg-slate-50 transition-colors bg-slate-50/50">
                  <td className="px-4 py-2 pl-8 text-sm text-slate-600">↳ {s.broker} - {s.name}</td>
                  <td className="px-4 py-2 text-sm text-slate-400">子項目</td>
                  <td className="px-4 py-2 text-sm text-right text-slate-600">${s.market_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="px-4 py-2 text-right text-slate-300">-</td>
                  <td className="px-4 py-2 text-right text-slate-300">-</td>
                </tr>
              ))}
              
              <tr className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-medium text-slate-800">信用卡負債</td>
                <td className="px-4 py-3 text-slate-500">流動負債</td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">
                  ${(latestBs?.detail?.credit_cards?.reduce((acc: number, item: any) => acc + item.payable, 0) ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">-</td>
                <td className="px-4 py-3 text-right text-slate-300">-</td>
              </tr>
              {latestBs?.detail?.credit_cards?.filter((cc: any) => cc.payable !== 0)?.map((cc: any, i: number) => (
                <tr key={`cc-${i}`} className="hover:bg-slate-50 transition-colors bg-slate-50/50">
                  <td className="px-4 py-2 pl-8 text-sm text-slate-600">↳ {cc.name}</td>
                  <td className="px-4 py-2 text-sm text-slate-400">子項目</td>
                  <td className="px-4 py-2 text-sm text-right text-slate-600">${cc.payable.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="px-4 py-2 text-right text-slate-300">-</td>
                  <td className="px-4 py-2 text-right text-slate-300">-</td>
                </tr>
              ))}

              <tr className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-medium text-slate-800">分期與其他負債</td>
                <td className="px-4 py-3 text-slate-500">流動負債</td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">
                  ${(latestBs?.detail?.liabilities?.reduce((acc: number, item: any) => acc + item.balance, 0) ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">-</td>
                <td className="px-4 py-3 text-right text-slate-300">-</td>
              </tr>
              {latestBs?.detail?.liabilities?.filter((l: any) => l.balance !== 0)?.map((l: any, i: number) => (
                <tr key={`liab-${i}`} className="hover:bg-slate-50 transition-colors bg-slate-50/50">
                  <td className="px-4 py-2 pl-8 text-sm text-slate-600">↳ {l.name}</td>
                  <td className="px-4 py-2 text-sm text-slate-400">子項目</td>
                  <td className="px-4 py-2 text-sm text-right text-slate-600">${l.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="px-4 py-2 text-right text-slate-300">-</td>
                  <td className="px-4 py-2 text-right text-slate-300">-</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual adjustments Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 max-w-2xl w-full max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-800">手動調整餘額 ({formatMonth(currentDate)})</h3>
                <p className="text-xs text-slate-500 mt-0.5">您可以新增手動帳戶（如分期付款）或更新現有帳戶的本月餘額</p>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* Account Creator Form Toggle */}
              {!isAddingAccount ? (
                <button 
                  onClick={() => setIsAddingAccount(true)}
                  className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-bold transition-colors border border-dashed border-slate-300"
                >
                  + 新增手動項目 / 帳戶
                </button>
              ) : (
                <form onSubmit={handleCreateAccount} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
                  <h4 className="text-sm font-bold text-slate-700">建立手動帳戶</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">項目名稱 (例如: MacBook 分期)</label>
                      <input 
                        type="text" 
                        required
                        value={newAccName}
                        onChange={e => setNewAccName(e.target.value)}
                        placeholder="輸入帳戶名稱" 
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">金融機構 (例如: 台新銀行, 自有現金)</label>
                      <input 
                        type="text" 
                        required
                        value={newAccInst}
                        onChange={e => setNewAccInst(e.target.value)}
                        placeholder="輸入機構名稱" 
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">項目類型</label>
                    <select 
                      value={newAccType}
                      onChange={e => setNewAccType(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-blue-500"
                    >
                      <option value="liability">分期與借貸負債 (Liability)</option>
                      <option value="bank">銀行與現金帳戶 (Bank/Cash)</option>
                      <option value="credit_card">信用卡帳戶 (Credit Card)</option>
                      <option value="brokerage">證券投資帳戶 (Brokerage)</option>
                    </select>
                  </div>
                  <div className="flex justify-end gap-2 text-sm pt-2">
                    <button 
                      type="button"
                      onClick={() => setIsAddingAccount(false)}
                      className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50"
                    >
                      取消
                    </button>
                    <button 
                      type="submit"
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700"
                    >
                      建立
                    </button>
                  </div>
                </form>
              )}

              {/* Account Balances List */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">本月餘額登錄</h4>
                
                {accounts.length === 0 ? (
                  <div className="text-center py-8 text-sm text-slate-400">目前尚無帳戶項目，請先新增帳戶。</div>
                ) : (
                  <div className="space-y-3">
                    {accounts.map(acc => (
                      <div key={acc.id} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-colors">
                        <div>
                          <div className="font-bold text-slate-800 text-sm">{acc.name}</div>
                          <div className="flex gap-2 items-center text-xxs mt-0.5">
                            <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase font-bold">
                              {acc.type === "liability" ? "負債" : acc.type === "credit_card" ? "信用卡" : acc.type === "brokerage" ? "證券" : "銀行"}
                            </span>
                            <span className="text-slate-400">{acc.institution}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 text-sm font-bold">$</span>
                          <input 
                            type="number"
                            placeholder="輸入餘額"
                            value={editBalances[acc.id] ?? ""}
                            onChange={e => setEditBalances(prev => ({ ...prev, [acc.id]: e.target.value }))}
                            className="w-32 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-right font-medium text-slate-800 focus:outline-none focus:border-blue-500 focus:bg-white"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-100 transition-colors"
              >
                關閉
              </button>
              <button 
                onClick={handleSaveBalances}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 shadow-sm transition-colors"
              >
                儲存本月餘額
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
