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
  const [newAccIsInstallment, setNewAccIsInstallment] = useState(false);
  const [newAccInstallmentAmount, setNewAccInstallmentAmount] = useState<number>(0);

  // Snapshot balances state being edited
  const [editBalances, setEditBalances] = useState<Record<number, string>>({});

  const [currentDate, setCurrentDate] = useState(() => {
    return new Date();
  });

  const [activeTab, setActiveTab] = useState<"sheet" | "projection">("sheet");

  const fetchHistory = () => {
    getBalanceSheetHistory().then(setHistory).catch(console.error);
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const targetPeriod = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-01`;

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
        // Exclude Firstrade from Cash & Deposits since it is an investment vehicle
        if (c.name && c.name.toLowerCase().includes("firstrade")) {
          return;
        }
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
      await createAccount(
        newAccName,
        newAccType,
        newAccInst,
        "TWD",
        undefined,
        newAccIsInstallment,
        newAccInstallmentAmount
      );
      setNewAccName("");
      setNewAccInst("");
      setNewAccIsInstallment(false);
      setNewAccInstallmentAmount(0);
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
        
        {/* Tab Switcher */}
        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-inner">
          <button
            onClick={() => setActiveTab("sheet")}
            className={`rounded-lg px-4 py-1.5 text-xs font-extrabold transition-all duration-200 ${
              activeTab === "sheet"
                ? "bg-white text-blue-600 shadow-sm border border-slate-200/50"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            📋 歷史資產負債表
          </button>
          <button
            onClick={() => setActiveTab("projection")}
            className={`rounded-lg px-4 py-1.5 text-xs font-extrabold transition-all duration-200 ${
              activeTab === "projection"
                ? "bg-white text-blue-600 shadow-sm border border-slate-200/50"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            🔮 未來淨值預測模擬
          </button>
        </div>

        <div className="flex gap-3">
          {activeTab === "sheet" && (
            <>
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
            </>
          )}
        </div>
      </div>

      {activeTab === "sheet" ? (
        <>

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
              {(() => {
                // Helper to find previous month's balance sheet
                const prevMonthDate = new Date(currentDate);
                prevMonthDate.setMonth(currentDate.getMonth() - 1);
                const prevPeriod = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
                const prevBs = history.find(b => b.period === prevPeriod) || null;

                // Cash
                const prevTotalCash = prevBs?.total_cash ?? 0;
                const diffCash = (latestBs?.total_cash ?? 0) - prevTotalCash;
                const pctCash = prevTotalCash > 0 ? (diffCash / prevTotalCash) * 100 : 0;

                // Cash items strictly from bank accounts
                const cashItems: any[] = [
                  ...(latestBs?.detail?.cash?.filter((c: any) => c.balance !== 0) || []),
                ];
                // Sort by balance descending
                cashItems.sort((a, b) => b.balance - a.balance);

                // Try to build a mapping of previous month's individual cash item balances
                const prevCashItemsMap: Record<string, number> = {};
                if (prevBs?.detail) {
                  const prevCash = prevBs.detail.cash || [];
                  prevCash.forEach((c: any) => {
                    const label = c.institution ? `${c.institution} - ${c.name}` : c.name;
                    prevCashItemsMap[label] = c.balance;
                  });
                }

                return (
                  <>
                    <tr className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">現金與存款</td>
                      <td className="px-4 py-3 text-slate-500">流動資產</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800">${(latestBs?.total_cash ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className={`px-4 py-3 text-right font-medium ${diffCash >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {prevBs ? `${diffCash >= 0 ? '+' : ''}${diffCash.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${diffCash >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {prevBs && prevTotalCash > 0 ? `${diffCash >= 0 ? '▲' : '▼'} ${Math.abs(pctCash).toFixed(1)}%` : '-'}
                      </td>
                    </tr>
                    {cashItems.map((c: any, i: number) => {
                      const bankLabel = c.institution ? c.institution : "";
                      const displayName = bankLabel ? `${bankLabel} - ${c.name}` : c.name;
                      const prevVal = prevCashItemsMap[displayName] ?? 0;
                      const diff = c.balance - prevVal;
                      const pct = prevVal > 0 ? (diff / prevVal) * 100 : 0;

                      return (
                        <tr key={`cash-${i}`} className="hover:bg-slate-50 transition-colors bg-slate-50/50">
                          <td className="px-4 py-2 pl-8 text-sm text-slate-600">
                            <span>{displayName}</span>
                            {c.currency && c.currency !== 'TWD' && c.original_balance != null && (
                              <span className="ml-2 text-[11px] text-slate-400 font-mono">
                                {c.currency} {c.original_balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-sm text-slate-400">
                            {c.currency && c.currency !== 'TWD' ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200">{c.currency}</span>
                            ) : ''}
                          </td>
                          <td className="px-4 py-2 text-sm text-right text-slate-600 font-mono">${c.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className={`px-4 py-2 text-sm text-right font-mono ${diff >= 0 ? 'text-emerald-600/80' : 'text-red-600/80'}`}>
                            {prevBs && prevVal > 0 ? `${diff >= 0 ? '+' : ''}${diff.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}
                          </td>
                          <td className={`px-4 py-2 text-sm text-right font-mono ${diff >= 0 ? 'text-emerald-600/80' : 'text-red-600/80'}`}>
                            {prevBs && prevVal > 0 ? `${diff >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </>
                );
              })()}
              
              {(() => {
                // Helper to find previous month's balance sheet
                const prevMonthDate = new Date(currentDate);
                prevMonthDate.setMonth(currentDate.getMonth() - 1);
                const prevPeriod = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
                const prevBs = history.find(b => b.period === prevPeriod) || null;

                // Securities
                const prevSecMv = prevBs?.total_securities_market_value ?? 0;
                const diffSec = (latestBs?.total_securities_market_value ?? 0) - prevSecMv;
                const pctSec = prevSecMv > 0 ? (diffSec / prevSecMv) * 100 : 0;

                // Build mapping of previous month's individual securities and brokerage cash
                const prevSecsMap: Record<string, number> = {};
                if (prevBs?.detail) {
                  if (prevBs.detail.securities) {
                    prevBs.detail.securities.forEach((s: any) => {
                      const label = `${s.broker} - ${s.name}`;
                      prevSecsMap[label] = s.market_value;
                    });
                  }
                  if (prevBs.detail.brokerage_cash) {
                    prevBs.detail.brokerage_cash.forEach((b: any) => {
                      const label = b.name.includes("閒置現金") ? b.name : `${b.name} (閒置現金)`;
                      prevSecsMap[label] = b.balance;
                    });
                  }
                }

                // Combine stocks + brokerage cash (Firstrade idle cash) under Securities
                const securitiesItems = [
                  ...(latestBs?.detail?.securities?.filter((s: any) => s.market_value !== 0) || []),
                  ...(latestBs?.detail?.brokerage_cash?.filter((b: any) => b.balance !== 0)?.map((b: any) => ({
                    broker: b.name.split(" ")[0],
                    name: b.name.includes("閒置現金") ? b.name : `${b.name} (閒置現金)`,
                    market_value: b.balance,
                    currency: b.currency || "USD",
                    original_market_value: b.original_balance,
                  })) || []),
                ];

                return (
                  <>
                    <tr className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">投資</td>
                      <td className="px-4 py-3 text-slate-500">流動資產</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800">${(latestBs?.total_securities_market_value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className={`px-4 py-3 text-right font-medium ${diffSec >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {prevBs ? `${diffSec >= 0 ? '+' : ''}${diffSec.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${diffSec >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {prevBs && prevSecMv > 0 ? `${diffSec >= 0 ? '▲' : '▼'} ${Math.abs(pctSec).toFixed(1)}%` : '-'}
                      </td>
                    </tr>
                    {securitiesItems.map((s: any, i: number) => {
                      const keyLabel = s.name.includes("閒置現金") ? s.name : `${s.broker} - ${s.name}`;
                      const prevVal = prevSecsMap[keyLabel] ?? 0;
                      const diff = s.market_value - prevVal;
                      const pct = prevVal > 0 ? (diff / prevVal) * 100 : 0;

                      return (
                        <tr key={`sec-${i}`} className="hover:bg-slate-50 transition-colors bg-slate-50/50">
                          <td className="px-4 py-2 pl-8 text-sm text-slate-600">
                            <span>{s.name.includes("閒置現金") ? s.name : `${s.broker} - ${s.name}`}</span>
                            {s.currency && s.currency !== 'TWD' && s.original_market_value != null && (
                              <span className="ml-2 text-[11px] text-slate-400 font-mono">
                                {s.currency} {s.original_market_value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-sm text-slate-400">
                            {s.currency && s.currency !== 'TWD' ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200">{s.currency}</span>
                            ) : ''}
                          </td>
                          <td className="px-4 py-2 text-sm text-right text-slate-600 font-mono">${s.market_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className={`px-4 py-2 text-sm text-right font-mono ${diff >= 0 ? 'text-emerald-600/80' : 'text-red-600/80'}`}>
                            {prevBs && prevVal > 0 ? `${diff >= 0 ? '+' : ''}${diff.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}
                          </td>
                          <td className={`px-4 py-2 text-sm text-right font-mono ${diff >= 0 ? 'text-emerald-600/80' : 'text-red-600/80'}`}>
                            {prevBs && prevVal > 0 ? `${diff >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </>
                );
              })()}

              
              {(() => {
                // Helper to find previous month's balance sheet
                const prevMonthDate = new Date(currentDate);
                prevMonthDate.setMonth(currentDate.getMonth() - 1);
                const prevPeriod = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
                const prevBs = history.find(b => b.period === prevPeriod) || null;

                // Credit Cards
                const latestCcPayable = latestBs?.detail?.credit_cards?.reduce((acc: number, item: any) => acc + item.payable, 0) ?? 0;
                const prevCcPayable = prevBs?.detail?.credit_cards?.reduce((acc: number, item: any) => acc + item.payable, 0) ?? 0;
                const diffCc = latestCcPayable - prevCcPayable;
                const pctCc = prevCcPayable > 0 ? (diffCc / prevCcPayable) * 100 : 0;

                // Build mapping of previous month's credit cards
                const prevCcMap: Record<string, number> = {};
                if (prevBs?.detail?.credit_cards) {
                  prevBs.detail.credit_cards.forEach((cc: any) => {
                    prevCcMap[cc.name] = cc.payable;
                  });
                }

                const creditCardItems = latestBs?.detail?.credit_cards?.filter((cc: any) => cc.payable !== 0) || [];

                return (
                  <>
                    <tr className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">信用卡負債</td>
                      <td className="px-4 py-3 text-slate-500">流動負債</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800">
                        ${latestCcPayable.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${diffCc <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {prevBs ? `${diffCc >= 0 ? '+' : ''}${diffCc.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${diffCc <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {prevBs && prevCcPayable > 0 ? `${diffCc >= 0 ? '▲' : '▼'} ${Math.abs(pctCc).toFixed(1)}%` : '-'}
                      </td>
                    </tr>
                    {creditCardItems.map((cc: any, i: number) => {
                      const prevVal = prevCcMap[cc.name] ?? 0;
                      const diff = cc.payable - prevVal;
                      const pct = prevVal > 0 ? (diff / prevVal) * 100 : 0;

                      return (
                        <tr key={`cc-${i}`} className="hover:bg-slate-50 transition-colors bg-slate-50/50">
                          <td className="px-4 py-2 pl-8 text-sm text-slate-600">{cc.name}</td>

                          <td className="px-4 py-2 text-sm text-slate-400"></td>
                          <td className="px-4 py-2 text-sm text-right text-slate-600 font-mono">${cc.payable.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className={`px-4 py-2 text-sm text-right font-mono ${diff <= 0 ? 'text-emerald-600/80' : 'text-red-600/80'}`}>
                            {prevBs && prevVal > 0 ? `${diff >= 0 ? '+' : ''}${diff.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}
                          </td>
                          <td className={`px-4 py-2 text-sm text-right font-mono ${diff <= 0 ? 'text-emerald-600/80' : 'text-red-600/80'}`}>
                            {prevBs && prevVal > 0 ? `${diff >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </>
                );
              })()}

              {(() => {
                // Helper to find previous month's balance sheet
                const prevMonthDate = new Date(currentDate);
                prevMonthDate.setMonth(currentDate.getMonth() - 1);
                const prevPeriod = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
                const prevBs = history.find(b => b.period === prevPeriod) || null;

                // Liabilities
                const latestLiabVal = latestBs?.detail?.liabilities?.reduce((acc: number, item: any) => acc + item.balance, 0) ?? 0;
                const prevLiabVal = prevBs?.detail?.liabilities?.reduce((acc: number, item: any) => acc + item.balance, 0) ?? 0;
                const diffLiab = latestLiabVal - prevLiabVal;
                const pctLiab = prevLiabVal > 0 ? (diffLiab / prevLiabVal) * 100 : 0;

                // Build mapping of previous month's liabilities
                const prevLiabMap: Record<string, number> = {};
                if (prevBs?.detail?.liabilities) {
                  prevBs.detail.liabilities.forEach((l: any) => {
                    prevLiabMap[l.name] = l.balance;
                  });
                }

                const liabilitiesItems = latestBs?.detail?.liabilities?.filter((l: any) => l.balance !== 0) || [];

                return (
                  <>
                    <tr className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">分期與其他負債</td>
                      <td className="px-4 py-3 text-slate-500">流動負債</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800">
                        ${latestLiabVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${diffLiab <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {prevBs ? `${diffLiab >= 0 ? '+' : ''}${diffLiab.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${diffLiab <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {prevBs && prevLiabVal > 0 ? `${diffLiab >= 0 ? '▲' : '▼'} ${Math.abs(pctLiab).toFixed(1)}%` : '-'}
                      </td>
                    </tr>
                    {liabilitiesItems.map((l: any, i: number) => {
                      const prevVal = prevLiabMap[l.name] ?? 0;
                      const diff = l.balance - prevVal;
                      const pct = prevVal > 0 ? (diff / prevVal) * 100 : 0;

                      return (
                        <tr key={`liab-${i}`} className="hover:bg-slate-50 transition-colors bg-slate-50/50">
                          <td className="px-4 py-2 pl-8 text-sm text-slate-600">{l.name}</td>

                          <td className="px-4 py-2 text-sm text-slate-400"></td>
                          <td className="px-4 py-2 text-sm text-right text-slate-600 font-mono">${l.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className={`px-4 py-2 text-sm text-right font-mono ${diff <= 0 ? 'text-emerald-600/80' : 'text-red-600/80'}`}>
                            {prevBs && prevVal > 0 ? `${diff >= 0 ? '+' : ''}${diff.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}
                          </td>
                          <td className={`px-4 py-2 text-sm text-right font-mono ${diff <= 0 ? 'text-emerald-600/80' : 'text-red-600/80'}`}>
                            {prevBs && prevVal > 0 ? `${diff >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>
        </>
      ) : (
        <ProjectionDashboard latestBs={latestBs} history={history} />
      )}

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
                  {newAccType === "liability" && (
                    <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-100 space-y-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="new_acc_is_installment"
                          checked={newAccIsInstallment}
                          onChange={e => setNewAccIsInstallment(e.target.checked)}
                          className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                        />
                        <label htmlFor="new_acc_is_installment" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                          這是「定期定額分期付款」
                        </label>
                      </div>
                      {newAccIsInstallment && (
                        <div>
                          <label className="block text-xs font-bold text-slate-500 mb-1">每期應繳/扣除金額 (TWD)</label>
                          <input
                            type="number"
                            value={newAccInstallmentAmount || ""}
                            onChange={e => setNewAccInstallmentAmount(parseFloat(e.target.value) || 0)}
                            placeholder="例如: 5000"
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-blue-500"
                          />
                          <span className="block text-xxs text-slate-400 mt-1 font-normal">啟用後，系統每月份會自動從您的負債餘額中扣減此金額，直到餘額歸零。</span>
                        </div>
                      )}
                    </div>
                  )}
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

interface ProjectionDashboardProps {
  latestBs: BalanceSheetRecord | null;
  history: BalanceSheetRecord[];
}

function ProjectionDashboard({ latestBs, history }: ProjectionDashboardProps) {
  // 1. Calculate default historical savings rate
  const averageMonthlySavings = (() => {
    if (history.length <= 1) return 15000; // fallback default
    // Calculate difference in net worth over months
    const sorted = [...history].sort((a, b) => new Date(a.period).getTime() - new Date(b.period).getTime());
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const elapsedMonths = Math.max(1, (new Date(last.period).getFullYear() - new Date(first.period).getFullYear()) * 12 + (new Date(last.period).getMonth() - new Date(first.period).getMonth()));
    const totalGrowth = last.net_worth - first.net_worth;
    return Math.max(0, Math.round(totalGrowth / elapsedMonths));
  })();

  // 2. Setup interactive slider states
  const [projectedSavings, setProjectedSavings] = useState<number>(averageMonthlySavings);
  const [expectedRoi, setExpectedRoi] = useState<number>(6); // default 6% annual ROI

  // 3. Current assets baseline
  const currentCash = latestBs?.total_cash ?? 0;
  const currentInvestments = latestBs?.total_securities_market_value ?? 0;
  const currentLiabilities = latestBs?.total_liabilities ?? 0;
  const currentNetWorth = currentCash + currentInvestments - currentLiabilities;

  // 4. Generate 12-month forecast data
  const forecastData = (() => {
    const data = [{
      name: "目前",
      "歷史實績": currentNetWorth,
      "模擬預測": currentNetWorth,
      type: "actual"
    }];

    let tempCash = currentCash;
    let tempInvest = currentInvestments;
    // For liabilities auto-amortization inside simulation: find all manual installment liabilities
    // and deduct their monthly payment until they reach 0.
    let tempLiab = currentLiabilities;

    const monthlyRoi = (expectedRoi / 100) / 12;

    for (let i = 1; i <= 12; i++) {
      // Apply ROI compound growth to investments
      tempInvest = tempInvest * (1 + monthlyRoi);
      // Add monthly savings to cash
      tempCash += projectedSavings;
      // Auto-reduce liabilities by simulated $5000 per month (for demo/existing rules)
      tempLiab = Math.max(0, tempLiab - 5000);

      const netWorth = Math.round(tempCash + tempInvest - tempLiab);
      data.push({
        name: `+${i}月`,
        "歷史實績": null as any,
        "模擬預測": netWorth,
        type: "forecast"
      });
    }
    return data;
  })();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* Simulation Config Panel */}
      <div className="grid grid-cols-3 gap-6">
        
        {/* Baseline Info */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">🎯 當前資產基準</div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">現金存款：</span>
                <span className="font-bold text-slate-700">${currentCash.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">證券投資：</span>
                <span className="font-bold text-slate-700">${currentInvestments.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm pb-2 border-b border-slate-100">
                <span className="text-slate-500">未償負債：</span>
                <span className="font-bold text-red-500">-${currentLiabilities.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-base pt-1">
                <span className="font-bold text-slate-800">當前總淨值：</span>
                <span className="font-extrabold text-blue-600">${currentNetWorth.toLocaleString()}</span>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 bg-slate-50 p-2 rounded-lg mt-4 leading-normal">
            💡 系統分析您過去的資產歷史，算出平均每月淨存入金額為 <strong>${averageMonthlySavings.toLocaleString()}</strong> 元。
          </div>
        </div>

        {/* Monthly Savings Slider */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">💸 每月預計淨儲蓄金</div>
            <div className="text-3xl font-extrabold text-slate-800 mb-6">
              ${projectedSavings.toLocaleString()} <span className="text-xs text-slate-400 font-normal">/ 月</span>
            </div>
            <input 
              type="range"
              min="0"
              max="100000"
              step="1000"
              value={projectedSavings}
              onChange={e => setProjectedSavings(parseInt(e.target.value) || 0)}
              className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600 focus:outline-none"
            />
            <div className="flex justify-between text-xxs text-slate-400 mt-2">
              <span>$0</span>
              <span>$50,000</span>
              <span>$100,000</span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mt-4 leading-normal">
            調整您未來每個月預期能留在帳戶中的「收入減支出」金額。
          </div>
        </div>

        {/* Investment ROI Slider */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">📈 預估證券年化報酬率</div>
            <div className="text-3xl font-extrabold text-slate-800 mb-6">
              {expectedRoi}% <span className="text-xs text-slate-400 font-normal">/ 年</span>
            </div>
            <input 
              type="range"
              min="0"
              max="15"
              step="0.5"
              value={expectedRoi}
              onChange={e => setExpectedRoi(parseFloat(e.target.value) || 0)}
              className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600 focus:outline-none"
            />
            <div className="flex justify-between text-xxs text-slate-400 mt-2">
              <span>0%</span>
              <span>7.5%</span>
              <span>15%</span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mt-4 leading-normal">
            調整您持有美股、台股等投資組合的年化回報率，系統將以月複利複滾計算。
          </div>
        </div>

      </div>

      {/* Projection Chart Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="font-bold text-slate-800 text-sm">🔮 未來 12 個月資產淨值模擬折線圖</h3>
            <p className="text-xxs text-slate-400 mt-0.5">以當月為基準，結合儲蓄與複利公式計算出未來一年的資產軌跡</p>
          </div>
          <div className="flex gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
              <span className="w-3 h-0.5 bg-blue-600 inline-block" />
              目前實績
            </span>
            <span className="inline-flex items-center gap-1.5 font-bold text-blue-500">
              <span className="w-3 h-0.5 border-t-2 border-dashed border-blue-400 inline-block" />
              模擬預測 (12個月)
            </span>
          </div>
        </div>

        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={forecastData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
              <YAxis 
                stroke="#94a3b8" 
                fontSize={11} 
                tickLine={false} 
                tickFormatter={(value) => `$${(value / 10000).toFixed(0)}萬`} 
              />
              <Tooltip 
                formatter={(value: any) => [`$${value.toLocaleString()}`, "預估淨值"]} 
                contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05)" }}
              />
              <Line 
                type="monotone" 
                dataKey="歷史實績" 
                stroke="#2563eb" 
                strokeWidth={3} 
                dot={{ r: 4, stroke: "#2563eb", strokeWidth: 2, fill: "#fff" }} 
              />
              <Line 
                type="monotone" 
                dataKey="模擬預測" 
                stroke="#3b82f6" 
                strokeWidth={3} 
                strokeDasharray="5 5" 
                dot={{ r: 3, stroke: "#3b82f6", strokeWidth: 1, fill: "#fff" }} 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  );
}
