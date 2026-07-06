import { useEffect, useState } from "react";
import { 
  getStockTransactions, 
  TransactionRecord, 
  getStockTransactionsSummary, 
  StockTransactionsSummaryItem 
} from "../services/api";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

export default function StockTransactionsPage() {
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d;
  });
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [summary, setSummary] = useState<StockTransactionsSummaryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBroker, setSelectedBroker] = useState<string>("all");
  const [summaryMonths, setSummaryMonths] = useState<number>(6);

  useEffect(() => {
    const fetchTxnsAndSummary = async () => {
      setIsLoading(true);
      try {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const [txns, summ] = await Promise.all([
          getStockTransactions(year, month),
          getStockTransactionsSummary(summaryMonths)
        ]);
        setTransactions(txns);
        setSummary(summ);
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTxnsAndSummary();
  }, [currentDate, summaryMonths]);

  const handlePrevMonth = () => setCurrentDate(d => { const nd = new Date(d); nd.setMonth(d.getMonth() - 1); return nd; });
  const handleNextMonth = () => setCurrentDate(d => { const nd = new Date(d); nd.setMonth(d.getMonth() + 1); return nd; });
  const formatMonth = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月`;

  // Extract all unique brokers from current month's transactions
  const availableBrokers = Array.from(
    new Set(transactions.map(t => t.institution || t.merchant).filter(Boolean))
  ) as string[];

  // Filter transactions based on selection
  const filteredTransactions = selectedBroker === "all"
    ? transactions
    : transactions.filter(t => (t.institution || t.merchant) === selectedBroker);

  // Compute metrics for the current viewed month (based on filtered transactions)
  const currentBuys = filteredTransactions.reduce((acc, t) => t.amount < 0 ? acc + Math.abs(t.amount) : acc, 0);
  const currentSells = filteredTransactions.reduce((acc, t) => t.amount > 0 ? acc + t.amount : acc, 0);
  const netFlow = currentSells - currentBuys;

  // Compute stats per broker for comparison card
  const brokerStats = availableBrokers.map(broker => {
    const brokerTxns = transactions.filter(t => (t.institution || t.merchant) === broker);
    const buys = brokerTxns.reduce((acc, t) => t.amount < 0 ? acc + Math.abs(t.amount) : acc, 0);
    const sells = brokerTxns.reduce((acc, t) => t.amount > 0 ? acc + t.amount : acc, 0);
    return {
      name: broker,
      buys,
      sells,
      net: sells - buys,
      count: brokerTxns.length
    };
  }).sort((a, b) => b.buys + b.sells - (a.buys + a.sells)); // sort by volume

  // Format Recharts data
  const chartData = summary.map(item => ({
    name: item.month_label,
    "買進": item.buys,
    "賣出": item.sells
  }));

  return (
    <div className="animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">股票交易明細</h1>
          <p className="text-sm text-slate-500 mt-1">檢視您每個月的股票與證券進出紀錄與變化</p>
        </div>
        <div className="flex gap-3">
          {/* Broker Filter */}
          {availableBrokers.length > 0 && (
            <select
              value={selectedBroker}
              onChange={(e) => setSelectedBroker(e.target.value)}
              className="bg-white border border-slate-200 px-4 py-2 rounded-full text-xs font-bold text-slate-700 shadow-sm focus:outline-none focus:border-blue-500"
            >
              <option value="all">所有券商</option>
              {availableBrokers.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm text-xs font-bold text-slate-700">
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handlePrevMonth}>{"<"}</span>
            {formatMonth(currentDate)}
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handleNextMonth}>{">"}</span>
          </div>
        </div>
      </div>

      {/* Dashboard Section */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="text-xs font-bold text-slate-400 mb-1">
            {selectedBroker === "all" ? "本月累計買進 (所有券商)" : `本月累計買進 (${selectedBroker})`}
          </div>
          <div className="text-2xl font-bold text-slate-800">${currentBuys.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div className="text-xxs text-slate-400 mt-1">證券交割扣款金額</div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="text-xs font-bold text-slate-400 mb-1">
            {selectedBroker === "all" ? "本月累計賣出 (所有券商)" : `本月累計賣出 (${selectedBroker})`}
          </div>
          <div className="text-2xl font-bold text-green-600">${currentSells.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div className="text-xxs text-slate-400 mt-1">證券交割入帳金額</div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="text-xs font-bold text-slate-400 mb-1">當月交易淨流向</div>
          <div className={`text-2xl font-bold ${netFlow >= 0 ? 'text-green-600' : 'text-blue-600'}`}>
            {netFlow >= 0 ? `+ $${netFlow.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `- $${Math.abs(netFlow).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          </div>
          <div className="text-xxs text-slate-400 mt-1">{netFlow >= 0 ? "資金流回銀行存款" : "銀行存款流向證券資產"}</div>
        </div>
      </div>

      {/* Historical Chart & Broker Breakdown Section */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        {/* Left: Historical Chart */}
        <div className={`${brokerStats.length > 0 ? 'col-span-2' : 'col-span-3'} bg-white rounded-2xl shadow-sm border border-slate-100 p-6`}>
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-slate-800 text-sm">
              {summaryMonths === 6 ? "最近半年交易歷史變動" : "最近一年 (12個月) 交易歷史變動"}
            </h3>
            <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg text-[10px] font-bold">
              <button
                onClick={() => setSummaryMonths(6)}
                className={`px-3 py-1 rounded-md transition-all ${summaryMonths === 6 ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                6個月
              </button>
              <button
                onClick={() => setSummaryMonths(12)}
                className={`px-3 py-1 rounded-md transition-all ${summaryMonths === 12 ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                12個月 (年度)
              </button>
            </div>
          </div>

          {summary.length > 0 ? (
            <div className="w-full h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(val) => `$${val.toLocaleString()}`} />
                  <Tooltip formatter={(value: number) => `$${value.toLocaleString()}`} contentStyle={{ background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Legend />
                  <Bar dataKey="買進" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={24} />
                  <Bar dataKey="賣出" fill="#10b981" radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-400 text-xs font-bold">暫無歷史數據</div>
          )}
        </div>

        {/* Right: Broker Breakdown Card */}
        {brokerStats.length > 0 && (
          <div className="col-span-1 bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-slate-800 mb-4 text-sm">當月券商交易佔比與統計</h3>
              <div className="space-y-4 max-h-[160px] overflow-y-auto pr-1">
                {brokerStats.map((item) => (
                  <div key={item.name} className="border-b border-slate-50 last:border-0 pb-3 last:pb-0">
                    <div className="flex justify-between items-center mb-1">
                      <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xxs font-bold border border-blue-100/50">
                        {item.name}
                      </span>
                      <span className="text-[10px] text-slate-400 font-semibold">
                        交易 {item.count} 筆
                      </span>
                    </div>
                    <div className="flex justify-between text-xxs text-slate-500 font-mono mt-1">
                      <div>
                        買入: <span className="text-slate-700 font-bold">${item.buys.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div>
                        賣出: <span className="text-green-600 font-bold">${item.sells.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100/50 mt-4">
              <div className="text-[10px] font-bold text-slate-400 mb-0.5">總計交易券商家數</div>
              <div className="text-xs font-bold text-slate-700">{availableBrokers.length} 家證券商已同步</div>
            </div>
          </div>
        )}
      </div>

      {/* Main Content: Transactions List */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center text-slate-500 font-bold">載入中...</div>
        ) : filteredTransactions.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-400">
            <div className="font-bold text-lg text-slate-500 mb-2">本月尚無該券商之股票交易紀錄</div>
            <div className="text-sm mt-2">系統已自動為您過濾其他日常收支</div>
          </div>
        ) : (
          <table className="w-full text-left text-sm relative">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">交割日期</th>
                <th className="px-6 py-4">券商</th>
                <th className="px-6 py-4">摘要</th>
                <th className="px-6 py-4 text-right">交易股數</th>
                <th className="px-6 py-4 text-right">成交單價</th>
                <th className="px-6 py-4 text-right">入帳金額 (賣出)</th>
                <th className="px-6 py-4 text-right">扣款金額 (買進)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.map((t) => {
                const qtyMatch = t.description?.match(/\b(\d+(?:\.\d+)?)\s*股/);
                const qty = qtyMatch ? parseFloat(qtyMatch[1]) : null;
                const price = (qty !== null && qty > 0) ? Math.abs(t.amount) / qty : null;
                return (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-slate-500 whitespace-nowrap">{t.date}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded text-xs font-bold border border-blue-100">
                        {t.institution || t.merchant || "證券商"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-800 font-medium">{t.description || '-'}</td>
                    <td className="px-6 py-4 text-right font-mono font-medium whitespace-nowrap">
                      {qty !== null ? `${qty.toLocaleString()} 股` : '-'}
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-slate-500 whitespace-nowrap">
                      {price !== null ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-green-600 whitespace-nowrap">
                      {t.amount > 0 ? `+ $${t.amount.toLocaleString()}` : '-'}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-slate-800 whitespace-nowrap">
                      {t.amount < 0 ? `- $${Math.abs(t.amount).toLocaleString()}` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
