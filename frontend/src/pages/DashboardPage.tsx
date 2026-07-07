import { useEffect, useState } from "react";
import { 
  getBalanceSheetHistory, 
  getIncomeStatementHistory, 
  BalanceSheetRecord, 
  IncomeStatementRecord,
  getTransactions,
  TransactionRecord
} from "../services/api";
import { Link } from "react-router-dom";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from "recharts";

const EXPENSE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#64748b"];

export default function DashboardPage() {
  const [bsHistory, setBsHistory] = useState<BalanceSheetRecord[]>([]);
  const [isHistory, setIsHistory] = useState<IncomeStatementRecord[]>([]);

  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d;
  });

  const [recentTxns, setRecentTxns] = useState<TransactionRecord[]>([]);

  useEffect(() => {
    getBalanceSheetHistory().then(setBsHistory).catch(console.error);
    getIncomeStatementHistory().then(setIsHistory).catch(console.error);
  }, []);

  useEffect(() => {
    getTransactions(currentDate.getFullYear(), currentDate.getMonth() + 1)
      .then(txns => setRecentTxns(txns.slice(0, 5)))
      .catch(console.error);
  }, [currentDate]);

  const handlePrevMonth = () => setCurrentDate(d => { const nd = new Date(d); nd.setMonth(d.getMonth() - 1); return nd; });
  const handleNextMonth = () => setCurrentDate(d => { const nd = new Date(d); nd.setMonth(d.getMonth() + 1); return nd; });
  const formatMonth = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月`;

  const targetPeriod = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-01`;

  const latestBs = bsHistory.find(b => b.period === targetPeriod) || null;
  const latestIs = isHistory.find(b => b.period === targetPeriod) || null;

  // Mock Trend Data for Net Worth
  const trendData = [...bsHistory].reverse().map(b => ({
    name: b.period.split("-")[1] + "月",
    value: b.net_worth
  }));

  const finalTrendData = trendData.length > 0 ? trendData : [];

  const pieData = latestIs && latestIs.total_expenses > 0 ? [
    { name: '信用卡支出', value: latestIs.credit_card_expenses },
    { name: '銀行支出', value: latestIs.bank_expenses },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="animate-in fade-in duration-500">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">財務總覽</h1>
          <p className="text-sm text-slate-500 mt-1">即時查看您的資產負債與收支趨勢</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm text-sm font-bold text-slate-700">
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handlePrevMonth}>{"<"}</span>
            {formatMonth(currentDate)}
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handleNextMonth}>{">"}</span>
          </div>
          <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
            <div className="text-right">
              <div className="text-sm font-bold text-slate-800">Sarah</div>
              <div className="text-xs font-medium text-slate-500">專屬個人財務管理</div>
            </div>
            <div className="w-10 h-10 bg-blue-50 rounded-xl shadow-sm border border-blue-100 flex items-center justify-center text-sm font-bold text-blue-600">
              S
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-6 mb-6">
        {[
          { label: "淨資產", val: latestBs?.net_worth ?? 0 },
          { label: "總資產", val: latestBs?.total_assets ?? 0 },
          { label: "總負債", val: latestBs?.total_liabilities ?? 0 },
          { label: "本月結餘", val: latestIs?.net_savings ?? 0 },
        ].map((k, i) => (
          <div key={i} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="text-sm font-bold text-slate-500 mb-2">{k.label}</div>
            <div className="text-2xl font-bold text-slate-900 mb-3">${k.val.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        {/* Line Chart */}
        <div className="col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-slate-800">淨資產變化趨勢</h3>
            <div className="flex gap-2">
              <button className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-bold">6個月</button>
              <button className="px-3 py-1 text-slate-400 hover:bg-slate-50 rounded-full text-xs font-bold transition-colors">1年</button>
              <button className="px-3 py-1 text-slate-400 hover:bg-slate-50 rounded-full text-xs font-bold transition-colors">全部</button>
            </div>
          </div>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={finalTrendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} dx={-10} tickFormatter={(val) => `${val >= 1000 ? (val/1000) + 'K' : val}`} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number) => [`$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, "淨資產"]}
                />
                <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bar Chart (Redesigned) */}
        <div className="col-span-1 bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-slate-800">支出分類比重 (本月)</h3>
            {latestIs && (
              <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                總計: ${latestIs.total_expenses.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            )}
          </div>
          <div className="flex-1 flex items-center justify-center min-h-[180px] w-full">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pieData} layout="vertical" margin={{ left: -10, right: 10, top: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#475569', fontWeight: 'bold' }} width={80} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [`$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, "支出金額"]}
                  />
                  <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={16}>
                    {pieData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={EXPENSE_COLORS[index % EXPENSE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-[180px] border-2 border-slate-100 rounded-2xl border-dashed flex items-center justify-center text-slate-300 text-sm">無資料</div>
            )}
          </div>
          
          {/* Legend Percentages */}
          <div className="mt-6 space-y-2">
            {pieData.map((d, i) => (
              <div key={i} className="flex justify-between items-center text-xs">
                <span className="text-slate-600 font-medium">{d.name}</span>
                <span className="text-slate-400 font-bold">{Math.round((d.value / (latestIs?.total_expenses || 1)) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-2 gap-6">
        {/* Summary List */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col">
          <h3 className="font-bold text-slate-800 mb-6">本月收支摘要</h3>
          <div className="flex-1 flex flex-col gap-4">
            <div className="flex justify-between items-center py-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                <span className="text-sm font-bold text-slate-600">薪資收入</span>
              </div>
              <span className="text-sm font-bold text-slate-800">${(latestIs?.salary_income ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-300"></span>
                <span className="text-sm font-bold text-slate-600">其他收入</span>
              </div>
              <span className="text-sm font-bold text-slate-800">${(latestIs?.investment_income ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="h-px bg-slate-100 w-full my-1"></div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm font-bold text-slate-800">總收入</span>
              <span className="text-sm font-bold text-slate-800">${(latestIs?.total_income ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm font-bold text-slate-800">總支出</span>
              <span className="text-sm font-bold text-red-500">- ${(latestIs?.total_expenses ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="mt-auto pt-4 flex justify-between items-center border-t border-slate-100">
              <span className="text-base font-bold text-slate-800">本月結餘</span>
              <span className="text-xl font-bold text-blue-600">${(latestIs?.net_savings ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          </div>
        </div>

        {/* Recent Txns */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col">
          <h3 className="font-bold text-slate-800 mb-6">近期交易</h3>
          <div className="flex-1 flex flex-col gap-1 overflow-y-auto">
            {recentTxns.length === 0 ? (
              <div className="text-sm text-slate-400 p-4 text-center">暫無近期交易紀錄</div>
            ) : (
              recentTxns.map((t) => (
                <div key={t.id} className="flex justify-between items-center py-2.5 border-b border-slate-50 last:border-0 hover:bg-slate-50 px-2 rounded-lg transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                      {t.source === "bank" ? "銀行" : t.source === "credit_card" ? "信用卡" : t.source === "einvoice" ? "發票" : "證券"}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-800">{t.description || t.merchant || "未知"}</div>
                      <div className="text-xs text-slate-400">{t.date} · {t.raw_category || t.category || "-"}</div>
                    </div>
                  </div>
                  <div className={`text-sm font-bold ${t.amount < 0 ? "text-slate-800" : "text-green-600"}`}>
                    {t.amount < 0 ? `- $${Math.abs(t.amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `+ $${t.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                  </div>
                </div>
              ))
            )}
          </div>
          <Link to="/transactions" className="mt-4 pt-4 border-t border-slate-100 text-center text-sm font-bold text-blue-600 hover:text-blue-700 cursor-pointer block">
            查看全部交易 ➔
          </Link>
        </div>

      </div>
    </div>
  );
}
