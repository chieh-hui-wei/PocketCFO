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

  useEffect(() => {
    const fetchTxnsAndSummary = async () => {
      setIsLoading(true);
      try {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const [txns, summ] = await Promise.all([
          getStockTransactions(year, month),
          getStockTransactionsSummary(6)
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
  }, [currentDate]);

  const handlePrevMonth = () => setCurrentDate(d => { const nd = new Date(d); nd.setMonth(d.getMonth() - 1); return nd; });
  const handleNextMonth = () => setCurrentDate(d => { const nd = new Date(d); nd.setMonth(d.getMonth() + 1); return nd; });
  const formatMonth = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月`;

  // Compute metrics for the current viewed month
  const currentBuys = transactions.reduce((acc, t) => t.amount < 0 ? acc + Math.abs(t.amount) : acc, 0);
  const currentSells = transactions.reduce((acc, t) => t.amount > 0 ? acc + t.amount : acc, 0);
  const netFlow = currentSells - currentBuys;

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
          <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm text-sm font-bold text-slate-700">
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handlePrevMonth}>{"<"}</span>
            {formatMonth(currentDate)}
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handleNextMonth}>{">"}</span>
          </div>
        </div>
      </div>

      {/* Dashboard Section */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="text-xs font-bold text-slate-400 mb-1">本月累計買進 (資金投入)</div>
          <div className="text-2xl font-bold text-slate-800">${currentBuys.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div className="text-xxs text-slate-400 mt-1">證券交割扣款金額</div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="text-xs font-bold text-slate-400 mb-1">本月累計賣出 (資金回收)</div>
          <div className="text-2xl font-bold text-green-600">${currentSells.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div className="text-xxs text-slate-400 mt-1">證券交割入帳金額</div>
        </div>
        <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 p-6`}>
          <div className="text-xs font-bold text-slate-400 mb-1">當月交易淨流向</div>
          <div className={`text-2xl font-bold ${netFlow >= 0 ? 'text-green-600' : 'text-blue-600'}`}>
            {netFlow >= 0 ? `+ $${netFlow.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `- $${Math.abs(netFlow).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          </div>
          <div className="text-xxs text-slate-400 mt-1">{netFlow >= 0 ? "資金流回銀行存款" : "銀行存款流向證券資產"}</div>
        </div>
      </div>

      {/* Historical Chart Section */}
      {summary.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 mb-6">
          <h3 className="font-bold text-slate-800 mb-4 text-sm">最近半年交易歷史變動</h3>
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
        </div>
      )}

      {/* Main Content: Transactions List */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center text-slate-500 font-bold">載入中...</div>
        ) : transactions.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-400">
            <div className="font-bold text-lg text-slate-500 mb-2">本月尚無股票交易紀錄</div>
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
              {transactions.map((t) => {
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
