import { useEffect, useState } from "react";
import { 
  getAccounts, 
  createAccount, 
  getSecuritiesForPeriod, 
  saveSecuritiesForAccount,
  Account,
  SecurityRecord,
  getSecuritiesHistory
} from "../services/api";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { toast } from "../store/useToastStore";
import { formatUtc8 } from "../utils/formatters";

interface EditableSecurity {
  ticker: string;
  name: string;
  quantity: string;
  avg_cost: string;
  current_price: string;
}

export default function StockHoldingsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | "overview">("overview");
  const [isEditing, setIsEditing] = useState(false);
  
  
  // Date State
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d;
  });
  
  const [allSecurities, setAllSecurities] = useState<SecurityRecord[]>([]);
  const [securities, setSecurities] = useState<EditableSecurity[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  // Account Form
  const [newBrokerName, setNewBrokerName] = useState("");
  const [newBrokerInst, setNewBrokerInst] = useState("");

  const [viewMode, setViewMode] = useState<"month" | "year">("month");
  const [securitiesHistory, setSecuritiesHistory] = useState<SecurityRecord[]>([]);

  const formatMonth = (d: Date) => viewMode === "year" ? `${d.getFullYear()}年` : `${d.getFullYear()}年${d.getMonth() + 1}月`;
  const targetPeriod = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-01`;

  // Reset edit state when account or date changes
  useEffect(() => {
    setIsEditing(false);
  }, [selectedAccountId, currentDate]);

  // Fetch accounts on mount
  const loadAccounts = () => {
    getAccounts()
      .then(all => {
        const brokers = all.filter(a => a.type === "brokerage");
        setAccounts(brokers);
      })
      .catch(console.error);
  };

  const loadHistory = () => {
    getSecuritiesHistory().then(setSecuritiesHistory).catch(console.error);
  };

  useEffect(() => {
    loadAccounts();
    loadHistory();
  }, []);

  useEffect(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    setIsLoading(true);
    
    getSecuritiesForPeriod(year, month, undefined)
      .then(all => {
        setAllSecurities(all);
        
        if (selectedAccountId !== "overview") {
          // Filter for this account
          const filtered = all.filter(s => s.account_id === selectedAccountId);
          const mapped = filtered.map(s => ({
            ticker: s.ticker,
            name: s.name,
            quantity: String(s.quantity),
            avg_cost: String(s.avg_cost),
            current_price: String(s.current_price),
          }));
          setSecurities(mapped);
        }
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [currentDate, selectedAccountId]);

  const handleAddRow = () => {
    setSecurities(prev => [
      ...prev,
      { ticker: "", name: "", quantity: "", avg_cost: "", current_price: "" }
    ]);
  };

  const handleRemoveRow = (idx: number) => {
    setSecurities(prev => prev.filter((_, i) => i !== idx));
  };

  const handleChangeRow = (idx: number, field: keyof EditableSecurity, val: string) => {
    setSecurities(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: val };
      return copy;
    });
  };

  const handleCreateBroker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrokerName || !newBrokerInst) return;
    try {
      const created = await createAccount(newBrokerName, "brokerage", newBrokerInst);
      setNewBrokerName("");
      setNewBrokerInst("");
      setIsAddingAccount(false);
      
      // Reload accounts and select the new one
      getAccounts().then(all => {
        const brokers = all.filter(a => a.type === "brokerage");
        setAccounts(brokers);
        const newlyCreated = brokers.find(b => b.code === created.code);
        if (newlyCreated) {
          setSelectedAccountId(newlyCreated.id);
        }
      });
    } catch (err) {
      console.error(err);
      toast.error("新增證券帳戶失敗");
    }
  };

  const handleSaveSecurities = async () => {
    if (selectedAccountId === "overview") return;
    setIsSaving(true);
    try {
      const list = securities
        .filter(s => s.ticker.trim() !== "")
        .map(s => ({
          ticker: s.ticker.trim(),
          name: s.name.trim() || s.ticker.trim(),
          quantity: parseFloat(s.quantity) || 0,
          avg_cost: parseFloat(s.avg_cost) || 0,
          current_price: parseFloat(s.current_price) || 0,
        }));
      
      await saveSecuritiesForAccount(selectedAccountId, targetPeriod, list);
      toast.success("庫存儲存成功，資產負債表已自動重新計算！");
      
      // Reload everything
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const all = await getSecuritiesForPeriod(year, month);
      setAllSecurities(all);
      loadHistory();
      setIsEditing(false);
    } catch (err) {
      console.error(err);
      toast.error("儲存失敗");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    const filtered = allSecurities.filter(s => s.account_id === selectedAccountId);
    const mapped = filtered.map(s => ({
      ticker: s.ticker,
      name: s.name,
      quantity: String(s.quantity),
      avg_cost: String(s.avg_cost),
      current_price: String(s.current_price),
    }));
    setSecurities(mapped);
    setIsEditing(false);
  };

  const selectedAccount = selectedAccountId !== "overview" ? accounts.find(a => a.id === selectedAccountId) || null : null;

  // Selected account market value (for editor)
  const totalMarketValue = securities.reduce((sum, s) => {
    const qty = parseFloat(s.quantity) || 0;
    const price = parseFloat(s.current_price) || parseFloat(s.avg_cost) || 0;
    return sum + (qty * price);
  }, 0);

  // Compile overview statistics
  const tickerGroups: Record<string, {
    ticker: string;
    name: string;
    totalQty: number;
    totalCost: number;
    currentPrice: number;
    totalMarketValue: number;
    unrealizedPnl: number;
    brokers: Array<{ accountName: string; quantity: number; marketValue: number }>;
  }> = {};

  allSecurities.forEach(s => {
    const accountName = accounts.find(a => a.id === s.account_id)?.name || "其他券商";
    if (!tickerGroups[s.ticker]) {
      tickerGroups[s.ticker] = {
        ticker: s.ticker,
        name: s.name,
        totalQty: 0,
        totalCost: 0,
        currentPrice: s.current_price,
        totalMarketValue: 0,
        unrealizedPnl: 0,
        brokers: []
      };
    }
    const g = tickerGroups[s.ticker];
    g.totalQty += s.quantity;
    g.totalCost += (s.avg_cost * s.quantity);
    g.totalMarketValue += s.market_value;
    g.unrealizedPnl += s.unrealized_pnl;
    if (s.current_price > 0) {
      g.currentPrice = s.current_price;
    }
    g.brokers.push({
      accountName,
      quantity: s.quantity,
      marketValue: s.market_value
    });
  });

  const aggregateList = Object.values(tickerGroups).map(g => ({
    ...g,
    avgCost: g.totalQty > 0 ? g.totalCost / g.totalQty : 0,
    roi: g.totalCost > 0 ? (g.unrealizedPnl / g.totalCost) * 100 : 0
  })).sort((a, b) => b.totalMarketValue - a.totalMarketValue);

  const brokerSums: Record<number, { accountName: string; marketValue: number; totalCost: number; unrealizedPnl: number; stockCount: number }> = {};
  accounts.forEach(a => {
    brokerSums[a.id] = { accountName: a.name, marketValue: 0, totalCost: 0, unrealizedPnl: 0, stockCount: 0 };
  });

  allSecurities.forEach(s => {
    if (brokerSums[s.account_id]) {
      brokerSums[s.account_id].marketValue += s.market_value;
      brokerSums[s.account_id].totalCost += (s.avg_cost * s.quantity);
      brokerSums[s.account_id].unrealizedPnl += s.unrealized_pnl;
      brokerSums[s.account_id].stockCount += 1;
    }
  });

  const brokerList = Object.values(brokerSums).map(b => ({
    ...b,
    roi: b.totalCost > 0 ? (b.unrealizedPnl / b.totalCost) * 100 : 0
  })).sort((a, b) => b.marketValue - a.marketValue);

  const totalPortfolioValue = brokerList.reduce((acc, b) => acc + b.marketValue, 0);
  const totalPortfolioCost = brokerList.reduce((acc, b) => acc + b.totalCost, 0);
  const totalPortfolioPnl = brokerList.reduce((acc, b) => acc + b.unrealizedPnl, 0);
  const totalPortfolioRoi = totalPortfolioCost > 0 ? (totalPortfolioPnl / totalPortfolioCost) * 100 : 0;

  // Selected Broker read-only calculations
  const brokerSecurities = allSecurities.filter(s => s.account_id === selectedAccountId);
  const selectedBrokerMarketValue = brokerSecurities.reduce((acc, s) => acc + s.market_value, 0);
  const selectedBrokerCost = brokerSecurities.reduce((acc, s) => acc + (s.avg_cost * s.quantity), 0);
  const selectedBrokerPnl = brokerSecurities.reduce((acc, s) => acc + s.unrealized_pnl, 0);
  const selectedBrokerRoi = selectedBrokerCost > 0 ? (selectedBrokerPnl / selectedBrokerCost) * 100 : 0;
  const selectedBrokerTickerCount = brokerSecurities.length;

  // Get latest created_at for allSecurities (overview)
  const overviewLastUpdated = allSecurities.reduce<string | undefined>((latest, s) => {
    if (!s.created_at) return latest;
    if (!latest) return s.created_at;
    return new Date(s.created_at) > new Date(latest) ? s.created_at : latest;
  }, undefined);

  // Get latest created_at for selected broker
  const brokerLastUpdated = brokerSecurities.reduce<string | undefined>((latest, s) => {
    if (!s.created_at) return latest;
    if (!latest) return s.created_at;
    return new Date(s.created_at) > new Date(latest) ? s.created_at : latest;
  }, undefined);

  const selectedBrokerList = brokerSecurities.map(s => {
    const cost = s.avg_cost * s.quantity;
    const roi = cost > 0 ? (s.unrealized_pnl / cost) * 100 : 0;
    const allocation = selectedBrokerMarketValue > 0 ? (s.market_value / selectedBrokerMarketValue) * 100 : 0;
    return {
      ...s,
      roi,
      allocation
    };
  }).sort((a, b) => b.market_value - a.market_value);

  // Check if we are in annual view mode
  const renderAnnualView = () => {
    // 1. Calculate values for the selected year
    const selectedYear = currentDate.getFullYear();
    
    // Filter history records for the selected year and selected brokerage account (if not overview)
    const yearSecurities = securitiesHistory.filter(s => {
      const y = s.period_date.substring(0, 4);
      const matchesYear = y === String(selectedYear);
      if (!matchesYear) return false;
      if (selectedAccountId !== "overview") {
        return s.account_id === selectedAccountId;
      }
      return true;
    });

    // Determine the list of tickers that appeared in this year
    const tickersInYear = Array.from(new Set(yearSecurities.map(s => s.ticker)));
    const tickerNames: Record<string, string> = {};
    yearSecurities.forEach(s => {
      tickerNames[s.ticker] = s.name || s.ticker;
    });

    // Calculate ticker values for each month (1月 to 12月)
    const tickerRows = tickersInYear.map(ticker => {
      const name = tickerNames[ticker];
      const monthlyValues = Array.from({ length: 12 }, (_, i) => {
        const monthStr = String(i + 1).padStart(2, "0");
        const monthSecs = yearSecurities.filter(s => s.ticker === ticker && s.period_date.substring(5, 7) === monthStr);
        return monthSecs.reduce((sum, s) => sum + s.market_value, 0);
      });
      
      const maxVal = Math.max(...monthlyValues);
      
      return {
        ticker,
        name,
        values: monthlyValues,
        maxVal,
      };
    }).sort((a, b) => b.maxVal - a.maxVal);

    // Compute monthly summary totals
    const monthlyTotals = Array.from({ length: 12 }, (_, i) => {
      const monthStr = String(i + 1).padStart(2, "0");
      const monthSecs = yearSecurities.filter(s => s.period_date.substring(5, 7) === monthStr);
      return monthSecs.reduce((sum, s) => sum + s.market_value, 0);
    });

    const monthlyPnls = Array.from({ length: 12 }, (_, i) => {
      const monthStr = String(i + 1).padStart(2, "0");
      const monthSecs = yearSecurities.filter(s => s.period_date.substring(5, 7) === monthStr);
      return monthSecs.reduce((sum, s) => sum + s.unrealized_pnl, 0);
    });

    // Define data for the trend LineChart
    const chartData = Array.from({ length: 12 }, (_, i) => {
      const monthNum = i + 1;
      return {
        name: `${monthNum}月`,
        "股票市值": monthlyTotals[i],
        "未實現損益": monthlyPnls[i],
      };
    });

    // Calculate some metrics for cards
    // Year-end or latest month with data
    const nonZeroIndices = monthlyTotals.map((val, idx) => val > 0 ? idx : -1).filter(idx => idx !== -1);
    const latestActiveIndex = nonZeroIndices.length > 0 ? Math.max(...nonZeroIndices) : -1;
    
    const yearEndValue = latestActiveIndex !== -1 ? monthlyTotals[latestActiveIndex] : 0;
    const yearEndPnl = latestActiveIndex !== -1 ? monthlyPnls[latestActiveIndex] : 0;
    
    const maxValInYear = Math.max(...monthlyTotals);
    const totalUniqueStocks = tickersInYear.length;

    // Formatting currency helper
    const formatCurrency = (val: number) => `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        {/* Metric Cards */}
        <div className="grid grid-cols-4 gap-6">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="text-xs font-bold text-slate-400 mb-1">
              {selectedAccountId === "overview" ? "年底整體股票市值" : "年底券商股票市值"}
            </div>
            <div className="text-2xl font-bold text-slate-800">{formatCurrency(yearEndValue)}</div>
            <div className="text-[10px] text-slate-400 mt-1">
              {latestActiveIndex !== -1 ? `${selectedYear}年${latestActiveIndex + 1}月最後計值` : "本年度尚無計值資料"}
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="text-xs font-bold text-slate-400 mb-1">年度市值高點</div>
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(maxValInYear)}</div>
            <div className="text-[10px] text-slate-400 mt-1">本年度單月估值最高峰</div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="text-xs font-bold text-slate-400 mb-1">年度未實現損益</div>
            <div className={`text-2xl font-bold ${yearEndPnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {yearEndPnl >= 0 ? `+ ${formatCurrency(yearEndPnl)}` : `- ${formatCurrency(Math.abs(yearEndPnl))}`}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">年度累計未實現損益估值</div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="text-xs font-bold text-slate-400 mb-1">年度曾持有標的數</div>
            <div className="text-2xl font-bold text-slate-800">{totalUniqueStocks} 檔</div>
            <div className="text-[10px] text-slate-400 mt-1">本年度累計持有的不同股票</div>
          </div>
        </div>

        {/* Line Chart */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-slate-800 text-sm">股票資產與損益趨勢 ({selectedYear}年度)</h3>
            <span className="text-[10px] text-slate-400 font-medium">(點擊折線圖上之月份點可直接切換至該月份明細)</span>
          </div>
          <div className="h-80 w-full font-sans">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart 
                data={chartData} 
                margin={{ top: 10, right: 30, left: 20, bottom: 0 }}
                onClick={(state) => {
                  if (state && state.activeTooltipIndex !== undefined) {
                    const monthIndex = state.activeTooltipIndex;
                    const targetDate = new Date(currentDate);
                    targetDate.setMonth(monthIndex);
                    setCurrentDate(targetDate);
                    setViewMode("month");
                  }
                }}
                className="cursor-pointer"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis 
                  stroke="#94a3b8" 
                  fontSize={11} 
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(val) => val >= 10000 ? `${(val / 10000).toFixed(0)}萬` : val}
                />
                <Tooltip 
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-md space-y-1.5 animate-in fade-in duration-100">
                          <div className="text-[11px] font-bold text-slate-400">{label}</div>
                          {payload.map((p: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-4 text-xs">
                              <span className="font-semibold" style={{ color: p.color }}>{p.name}:</span>
                              <span className="font-bold text-slate-800">{formatCurrency(Number(p.value))}</span>
                            </div>
                          ))}
                          <div className="pt-1.5 border-t border-slate-100 text-[10px] text-blue-500 font-bold flex items-center gap-1">
                            <span>💡</span>
                            <span>點擊可切換至該月庫存明細</span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="股票市值" 
                  stroke="#3b82f6" 
                  strokeWidth={3} 
                  dot={{ r: 4, strokeWidth: 2, fill: "#ffffff" }} 
                  activeDot={{ r: 7, stroke: "#3b82f6", strokeWidth: 3, fill: "#ffffff" }} 
                />
                <Line 
                  type="monotone" 
                  dataKey="未實現損益" 
                  stroke="#10b981" 
                  strokeWidth={2} 
                  strokeDasharray="4 4"
                  dot={{ r: 3, strokeWidth: 1, fill: "#ffffff" }} 
                  activeDot={{ r: 5, stroke: "#10b981", strokeWidth: 2, fill: "#ffffff" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 12-Month Table Grid (Income Statement style) */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-slate-800 text-sm">股票資產年度逐月庫存明細</h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const url = `/api/v1/accounts/securities/export?year=${selectedYear}` + 
                    (selectedAccountId !== "overview" ? `&account_id=${selectedAccountId}` : "");
                  window.open(url, "_blank");
                }}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all border border-slate-200 cursor-pointer"
              >
                匯出 Excel
              </button>
              <span className="text-xs text-slate-400">單位：新台幣 (元)</span>
            </div>
          </div>
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[1200px] table-fixed">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-3 py-3 w-40 sticky left-0 bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-10">標的</th>
                  {Array.from({ length: 12 }, (_, i) => (
                    <th key={i} className="px-2 py-3 text-right">{i + 1}月</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tickerRows.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="text-center py-12 text-slate-400 font-sans">
                      這個年度目前沒有任何持股庫存歷史資料。
                    </td>
                  </tr>
                ) : (
                  <>
                    {tickerRows.map(row => (
                      <tr key={row.ticker} className="hover:bg-slate-50/50 transition-colors font-mono">
                        <td className="px-3 py-3 font-sans sticky left-0 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-100 z-10">
                          <div className="font-bold text-slate-700 truncate">{row.name}</div>
                          <div className="text-[9px] text-slate-400 mt-0.5">{row.ticker}</div>
                        </td>
                        {row.values.map((val, idx) => (
                          <td key={idx} className={`px-2 py-3 text-right ${val > 0 ? "text-slate-700 font-semibold" : "text-slate-300"}`}>
                            {val > 0 ? val.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "-"}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {/* Summary row 1: Total Stock Value */}
                    <tr className="bg-slate-50/70 font-mono font-bold text-slate-800 border-t border-slate-300">
                      <td className="px-3 py-3 font-sans sticky left-0 bg-slate-50/70 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-200 z-10">
                        總股票市值
                      </td>
                      {monthlyTotals.map((val, idx) => (
                        <td key={idx} className="px-2 py-3 text-right text-blue-600">
                          {val > 0 ? val.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "-"}
                        </td>
                      ))}
                    </tr>
                    {/* Summary row 2: Total Unrealized PnL */}
                    <tr className="bg-slate-50/70 font-mono font-bold text-slate-800">
                      <td className="px-3 py-3 font-sans sticky left-0 bg-slate-50/70 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-200 z-10">
                        累計未實現損益
                      </td>
                      {monthlyPnls.map((val, idx) => (
                        <td key={idx} className={`px-2 py-3 text-right ${val >= 0 ? "text-green-600" : "text-red-500"}`}>
                          {val !== 0 ? (val > 0 ? "+" : "") + val.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "-"}
                        </td>
                      ))}
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">股票庫存與配置</h1>
          <p className="text-sm text-slate-500 mt-1">檢視各券商持股分布，以及手動登錄/API自動更新的月度庫存</p>
        </div>
        <div className="flex items-center gap-4">
          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-sm">
            <button
              onClick={() => setViewMode("month")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === "month"
                  ? "bg-white text-slate-800 shadow-sm border border-slate-200/50"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              月度明細
            </button>
            <button
              onClick={() => setViewMode("year")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === "year"
                  ? "bg-white text-slate-800 shadow-sm border border-slate-200/50"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              年度回顧
            </button>
          </div>

          {/* Date Selector */}
          <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm text-sm font-bold text-slate-700">
            <span 
              className="text-slate-400 cursor-pointer hover:text-slate-800 select-none" 
              onClick={() => {
                const d = new Date(currentDate);
                if (viewMode === "year") {
                  d.setFullYear(d.getFullYear() - 1);
                } else {
                  d.setMonth(d.getMonth() - 1);
                }
                setCurrentDate(d);
              }}
            >
              {"<"}
            </span>
            {formatMonth(currentDate)}
            <span 
              className="text-slate-400 cursor-pointer hover:text-slate-800 select-none" 
              onClick={() => {
                const d = new Date(currentDate);
                if (viewMode === "year") {
                  d.setFullYear(d.getFullYear() + 1);
                } else {
                  d.setMonth(d.getMonth() + 1);
                }
                setCurrentDate(d);
              }}
            >
              {">"}
            </span>
          </div>

        </div>
      </div>

      <div className="grid grid-cols-4 gap-6">
        {/* Left Side: Accounts & Navigation List */}
        <div className="col-span-1 bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex flex-col h-fit">
          <h3 className="font-bold text-slate-800 mb-4 flex justify-between items-center text-sm">
            <span>證券庫存選單</span>
          </h3>
          
          {/* Overview button */}
          <button
            onClick={() => setSelectedAccountId("overview")}
            className={`w-full text-left px-4 py-3.5 rounded-xl text-sm font-bold transition-all mb-2 flex items-center justify-between ${
              selectedAccountId === "overview"
                ? "bg-blue-50 text-blue-600 border border-blue-100 shadow-sm"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-800 border border-transparent"
            }`}
          >
            <span>投資總覽</span>
            <span className="text-[10px] font-mono bg-blue-100/70 text-blue-700 px-2 py-0.5 rounded-full font-bold">
              ${totalPortfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </button>

          <div className="border-t border-slate-100 my-2 pt-3">
            <div className="text-xxs font-bold text-slate-400 px-4 mb-2 tracking-wider">各券商持股</div>
            <div className="space-y-1 mb-4">
              {accounts.map(acc => {
                const brokerVal = brokerSums[acc.id]?.marketValue || 0;
                return (
                  <button
                    key={acc.id}
                    onClick={() => setSelectedAccountId(acc.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                      selectedAccountId === acc.id
                        ? "bg-blue-50 text-blue-600 border border-blue-100"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-800 border border-transparent"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div className="truncate">{acc.name}</div>
                      {brokerVal > 0 && (
                        <span className="text-[10px] text-slate-500 font-mono font-bold">${brokerVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 font-normal mt-0.5">{acc.institution}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {!isAddingAccount ? (
            <button
              onClick={() => setIsAddingAccount(true)}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors border border-dashed border-slate-300"
            >
              + 新增證券帳戶
            </button>
          ) : (
            <form onSubmit={handleCreateBroker} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 mt-2">
              <h4 className="text-xs font-bold text-slate-700">建立證券帳戶</h4>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">帳戶名稱 (如: 國泰證券)</label>
                <input 
                  type="text" 
                  required
                  value={newBrokerName}
                  onChange={e => setNewBrokerName(e.target.value)}
                  placeholder="帳戶名稱" 
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">券商機構 (如: 國泰世華)</label>
                <input 
                  type="text" 
                  required
                  value={newBrokerInst}
                  onChange={e => setNewBrokerInst(e.target.value)}
                  placeholder="券商名稱" 
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 text-[10px] pt-1">
                <button 
                  type="button"
                  onClick={() => setIsAddingAccount(false)}
                  className="px-2.5 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  className="px-2.5 py-1 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700"
                >
                  建立
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Right Side Panel */}
        <div className="col-span-3 min-h-[400px]">
          {isLoading ? (
            /* PULSING LOADING SKELETON */
            <div className="animate-pulse space-y-6">
              {/* Metric Cards Skeleton */}
              <div className="grid grid-cols-4 gap-6">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="bg-white rounded-2xl border border-slate-100 p-6 h-24 space-y-3">
                    <div className="h-3 w-2/3 bg-slate-100 rounded"></div>
                    <div className="h-6 w-1/2 bg-slate-100 rounded"></div>
                    <div className="h-2.5 w-3/4 bg-slate-100/50 rounded"></div>
                  </div>
                ))}
              </div>
              
              {/* Chart Skeleton */}
              <div className="bg-white rounded-2xl border border-slate-100 p-6 h-96 space-y-4">
                <div className="h-4 w-48 bg-slate-100 rounded"></div>
                <div className="h-72 w-full bg-slate-50 rounded-xl"></div>
              </div>

              {/* Table Skeleton */}
              <div className="bg-white rounded-2xl border border-slate-100 p-6 h-80 space-y-4">
                <div className="flex justify-between items-center">
                  <div className="h-4 w-60 bg-slate-100 rounded"></div>
                  <div className="h-3 w-16 bg-slate-100 rounded"></div>
                </div>
                <div className="h-56 w-full bg-slate-50 rounded-xl"></div>
              </div>
            </div>
          ) : viewMode === "year" ? (
            renderAnnualView()
          ) : selectedAccountId === "overview" ? (
            /* OVERVIEW PANEL */
            <div className="space-y-6">
              {/* Summary Metrics */}
              <div className="grid grid-cols-4 gap-6">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                  <div className="text-xs font-bold text-slate-400 mb-1">整體股票總市值</div>
                  <div className="text-2xl font-bold text-slate-800">${totalPortfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                  <div className="text-[10px] text-slate-400 mt-1">跨券商自動與手動持股彙總</div>
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                  <div className="text-xs font-bold text-slate-400 mb-1">標的持股檔數</div>
                  <div className="text-2xl font-bold text-blue-600">{aggregateList.length} 檔</div>
                  <div className="text-[10px] text-slate-400 mt-1">目前持有之不同標的數量</div>
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                  <div className="text-xs font-bold text-slate-400 mb-1">股票資產整體損益</div>
                  <div className={`text-2xl font-bold ${totalPortfolioPnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {totalPortfolioPnl >= 0 ? `+ $${totalPortfolioPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `- $${Math.abs(totalPortfolioPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">累計未實現損益估值</div>
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                  <div className="text-xs font-bold text-slate-400 mb-1">整體投資報酬率</div>
                  <div className={`text-2xl font-bold ${totalPortfolioPnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {totalPortfolioPnl >= 0 ? `+${totalPortfolioRoi.toFixed(2)}%` : `${totalPortfolioRoi.toFixed(2)}%`}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">整體持股未實現報酬率</div>
                </div>
              </div>

              {/* Table & Distribution */}
              <div className="space-y-6">
                {/* Aggregated Tickers Table */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col h-fit">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-slate-800 text-sm">跨券商股票持股彙總</h3>
                    {overviewLastUpdated ? (
                      <span className="text-xxs text-slate-400 font-normal">
                        更新時間：{formatUtc8(overviewLastUpdated)}
                      </span>
                    ) : (
                      <span className="text-xxs text-slate-400 font-normal italic">
                        （自動結轉前月餘額數據）
                      </span>
                    )}
                  </div>
                  <div className="border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-left text-sm min-w-[900px]">
                      <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-3">標的名稱</th>
                          <th className="px-3 py-3 text-right">總股數</th>
                          <th className="px-3 py-3 text-right">平均成本</th>
                          <th className="px-3 py-3 text-right">收盤現價</th>
                          <th className="px-3 py-3 text-right">估算市值</th>
                          <th className="px-3 py-3 text-right min-w-[110px]">未實現損益</th>
                          <th className="px-3 py-3 text-right">報酬率</th>
                          <th className="px-3 py-3 text-right min-w-[100px]">資產佔比</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {aggregateList.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="text-center py-12 text-slate-400 font-sans">
                              這個月目前沒有任何持股庫存資料。
                            </td>
                          </tr>
                        ) : (
                          aggregateList.map(item => {
                            const pct = totalPortfolioValue > 0 ? (item.totalMarketValue / totalPortfolioValue) * 100 : 0;
                            return (
                              <tr key={item.ticker} className="hover:bg-slate-50/50 transition-colors text-slate-700">
                                <td className="px-3 py-3 whitespace-nowrap font-sans">
                                  <div className="font-bold text-slate-700 whitespace-nowrap">{item.name}</div>
                                  <div className="text-[10px] text-slate-400 mt-1 whitespace-nowrap font-sans">
                                    <span className="font-mono bg-slate-100 text-slate-600 px-1 py-0.5 rounded font-normal">{item.ticker}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-right font-semibold">{item.totalQty.toLocaleString()}</td>
                                <td className="px-3 py-3 text-right text-slate-500">
                                  ${item.avgCost.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                                </td>
                                <td className="px-3 py-3 text-right text-slate-500">
                                  ${item.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                                </td>
                                <td className="px-3 py-3 text-right">
                                  <div className="text-slate-800 font-bold">
                                    ${item.totalMarketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-right">
                                  <div className={`font-bold ${item.unrealizedPnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                    {item.unrealizedPnl >= 0 ? `+ $${item.unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `- $${Math.abs(item.unrealizedPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                                  </div>
                                </td>
                                <td className={`px-3 py-3 text-right font-bold ${item.unrealizedPnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                  {item.roi >= 0 ? `+${item.roi.toFixed(2)}%` : `${item.roi.toFixed(2)}%`}
                                </td>
                                <td className="px-3 py-3 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <span>{pct.toFixed(1)}%</span>
                                    <div className="w-12 bg-slate-100 rounded-full h-1.5 overflow-hidden hidden sm:block">
                                      <div className="bg-emerald-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Broker Performance Summary Table */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                  <h3 className="font-bold text-slate-800 mb-4 text-sm">各證券商帳戶狀況彙總</h3>
                  <div className="border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3">券商帳戶</th>
                          <th className="px-4 py-3 text-center">持股檔數</th>
                          <th className="px-4 py-3 text-right">當月估算市值</th>
                          <th className="px-4 py-3 text-right">未實現損益</th>
                          <th className="px-4 py-3 text-right">投資報酬率</th>
                          <th className="px-4 py-3 text-right">資產佔比</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {brokerList.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="text-center py-8 text-slate-400 font-sans">
                              目前無券商持股資料。
                            </td>
                          </tr>
                        ) : (
                          brokerList.map(b => {
                            const pct = totalPortfolioValue > 0 ? (b.marketValue / totalPortfolioValue) * 100 : 0;
                            return (
                              <tr key={b.accountName} className="hover:bg-slate-50/50 transition-colors text-slate-700">
                                <td className="px-4 py-3 font-sans">
                                  <div className="font-bold text-slate-700">{b.accountName}</div>
                                </td>
                                <td className="px-4 py-3 text-center">{b.stockCount}</td>
                                <td className="px-4 py-3 text-right font-bold text-slate-800">${b.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                <td className={`px-4 py-3 text-right font-bold whitespace-nowrap min-w-[120px] ${b.unrealizedPnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                  {b.unrealizedPnl >= 0 ? `+ $${b.unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `- $${Math.abs(b.unrealizedPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                                </td>
                                <td className={`px-4 py-3 text-right font-bold ${b.unrealizedPnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                  {b.roi >= 0 ? `+${b.roi.toFixed(2)}%` : `${b.roi.toFixed(2)}%`}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <span>{pct.toFixed(0)}%</span>
                                    <div className="w-12 bg-slate-100 rounded-full h-1.5 overflow-hidden hidden sm:block">
                                      <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* INDIVIDUAL BROKER VIEW (DASHBOARD OR EDITOR) */
            <div className="space-y-6">
              {selectedAccount ? (
                !isEditing ? (
                  /* READ-ONLY DASHBOARD */
                  <div className="space-y-6">
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                      <div className="flex justify-between items-center mb-6">
                        <div>
                          <h3 className="font-bold text-slate-800 text-lg">{selectedAccount.name} 持股庫存</h3>
                          <p className="text-xs text-slate-400 mt-0.5">
                            顯示 {formatMonth(currentDate)} 底的持股狀況
                            {brokerLastUpdated 
                              ? `（更新時間：${formatUtc8(brokerLastUpdated)}）` 
                              : `（自動結轉前月餘額）`
                            }
                          </p>
                        </div>
                        <button
                          onClick={() => setIsEditing(true)}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm hover:shadow-md cursor-pointer"
                        >
                          編輯 / 手動登錄此月庫存
                        </button>
                      </div>

                      {/* Broker Specific Metrics */}
                      <div className="grid grid-cols-4 gap-6 mb-6">
                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                          <div className="text-[10px] font-bold text-slate-400 mb-1">券商估算總市值</div>
                          <div className="text-xl font-bold text-slate-800">${selectedBrokerMarketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                          <div className="text-[10px] font-bold text-slate-400 mb-1">持股標的數</div>
                          <div className="text-xl font-bold text-blue-600">{selectedBrokerTickerCount} 檔</div>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                          <div className="text-[10px] font-bold text-slate-400 mb-1">券商未實現損益</div>
                          <div className={`text-xl font-bold ${selectedBrokerPnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {selectedBrokerPnl >= 0 ? `+ $${selectedBrokerPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `- $${Math.abs(selectedBrokerPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                          </div>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                          <div className="text-[10px] font-bold text-slate-400 mb-1">券商投資報酬率</div>
                          <div className={`text-xl font-bold ${selectedBrokerPnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {selectedBrokerPnl >= 0 ? `+${selectedBrokerRoi.toFixed(2)}%` : `${selectedBrokerRoi.toFixed(2)}%`}
                          </div>
                        </div>
                      </div>

                      {/* Read-Only Holdings Table */}
                      <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                            <tr>
                              <th className="px-4 py-3">標的名稱</th>
                              <th className="px-4 py-3 text-right">持有股數</th>
                              <th className="px-4 py-3 text-right">平均成本</th>
                              <th className="px-4 py-3 text-right">收盤現價</th>
                              <th className="px-4 py-3 text-right">估算市值</th>
                              <th className="px-4 py-3 text-right">未實現損益</th>
                              <th className="px-4 py-3 text-right">報酬率</th>
                              <th className="px-4 py-3 text-right min-w-[100px]">資產佔比</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-mono">
                            {selectedBrokerList.length === 0 ? (
                              <tr>
                                <td colSpan={8} className="px-4 py-8 text-center text-slate-400 font-sans">
                                  無持股資料
                                </td>
                              </tr>
                            ) : (
                              selectedBrokerList.map(s => (
                                <tr key={s.ticker} className="hover:bg-slate-50 text-slate-700">
                                  <td className="px-4 py-3 font-sans">
                                    <div className="font-bold text-slate-800">{s.name || s.ticker}</div>
                                    <div className="text-[10px] text-slate-400">{s.ticker}</div>
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold">{s.quantity.toLocaleString()}</td>
                                  <td className="px-4 py-3 text-right">
                                    <div className="font-semibold">${s.avg_cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                    {s.currency === 'USD' && s.original_avg_cost != null && (
                                      <div className="text-[10px] text-slate-400">USD {s.original_avg_cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <div className="font-semibold">${s.current_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                    {s.currency === 'USD' && s.original_current_price != null && (
                                      <div className="text-[10px] text-slate-400">USD {s.original_current_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <div className="text-slate-800 font-bold">${s.market_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                                    {s.currency === 'USD' && s.original_market_value != null && (
                                      <div className="text-[10px] text-slate-400">USD {s.original_market_value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <div className={`font-bold ${s.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                      {s.unrealized_pnl >= 0 ? `+ $${s.unrealized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `- $${Math.abs(s.unrealized_pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                                    </div>
                                    {s.currency === 'USD' && s.original_unrealized_pnl != null && (
                                      <div className={`text-[10px] ${s.original_unrealized_pnl >= 0 ? 'text-green-500' : 'text-red-400'}`}>
                                        USD {s.original_unrealized_pnl >= 0 ? `+${s.original_unrealized_pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `${s.original_unrealized_pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                                      </div>
                                    )}
                                  </td>
                                  <td className={`px-4 py-3 text-right font-mono font-bold ${s.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                    {s.roi >= 0 ? `+${s.roi.toFixed(2)}%` : `${s.roi.toFixed(2)}%`}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      <span>{s.allocation.toFixed(1)}%</span>
                                      <div className="w-12 bg-slate-100 rounded-full h-1.5 overflow-hidden hidden sm:block">
                                        <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${s.allocation}%` }} />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* EDIT MODE (EXISTING INPUT FORM) */
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col min-h-[400px]">
                    <div className="flex justify-between items-center mb-6">
                      <div>
                        <h3 className="font-bold text-slate-800 text-lg">{selectedAccount.name} 持股編輯</h3>
                        <p className="text-xs text-slate-400 mt-0.5">手動登錄 {formatMonth(currentDate)} 底的持股明細 (現價留空或 0 將自動獲取當月最後一天收盤價)</p>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-slate-400">當月估算總市值</div>
                        <div className="text-2xl font-bold text-blue-600">${totalMarketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden mb-6 flex-1">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-3 w-1/5">標的代號</th>
                            <th className="px-4 py-3 w-1/4">標的名稱</th>
                            <th className="px-4 py-3 w-1/6 text-right">股數</th>
                            <th className="px-4 py-3 w-1/6 text-right">平均成本</th>
                            <th className="px-4 py-3 w-1/6 text-right">收盤現價</th>
                            <th className="px-4 py-3 text-right">估算市值</th>
                            <th className="px-4 py-3 text-center w-12">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {securities.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="text-center py-12 text-slate-400">
                                這個月目前沒有持股明細，請點擊下方的「新增持股明細」新增。
                              </td>
                            </tr>
                          ) : (
                            securities.map((s, idx) => {
                              const qty = parseFloat(s.quantity) || 0;
                              const price = parseFloat(s.current_price) || parseFloat(s.avg_cost) || 0;
                              const mv = qty * price;
                              return (
                                <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="px-4 py-2">
                                    <input 
                                      type="text"
                                      placeholder="如: 2330"
                                      value={s.ticker}
                                      onChange={e => handleChangeRow(idx, "ticker", e.target.value)}
                                      className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:bg-white"
                                    />
                                  </td>
                                  <td className="px-4 py-2">
                                    <input 
                                      type="text"
                                      placeholder="如: 台積電"
                                      value={s.name}
                                      onChange={e => handleChangeRow(idx, "name", e.target.value)}
                                      className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:bg-white"
                                    />
                                  </td>
                                  <td className="px-4 py-2 text-right">
                                    <input 
                                      type="number"
                                      placeholder="股數"
                                      value={s.quantity}
                                      onChange={e => handleChangeRow(idx, "quantity", e.target.value)}
                                      className="w-24 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-sm text-right text-slate-800 focus:outline-none focus:border-blue-500 focus:bg-white"
                                    />
                                  </td>
                                  <td className="px-4 py-2 text-right">
                                    <input 
                                      type="number"
                                      placeholder="單價"
                                      value={s.avg_cost}
                                      onChange={e => handleChangeRow(idx, "avg_cost", e.target.value)}
                                      className="w-24 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-sm text-right text-slate-800 focus:outline-none focus:border-blue-500 focus:bg-white"
                                    />
                                  </td>
                                  <td className="px-4 py-2 text-right">
                                    <input 
                                      type="number"
                                      placeholder="留空自動抓取"
                                      value={s.current_price}
                                      onChange={e => handleChangeRow(idx, "current_price", e.target.value)}
                                      className="w-24 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-sm text-right text-slate-800 focus:outline-none focus:border-blue-500 focus:bg-white"
                                    />
                                  </td>
                                  <td className="px-4 py-2 text-right text-slate-700 font-medium font-mono">
                                    ${mv.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  </td>
                                  <td className="px-4 py-2 text-center">
                                    <button 
                                      onClick={() => handleRemoveRow(idx)}
                                      className="text-red-500 hover:underline text-xs cursor-pointer font-bold"
                                      title="刪除本列"
                                    >
                                      刪除
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex justify-between items-center">
                      <button
                        onClick={handleAddRow}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-bold transition-colors shadow-sm cursor-pointer"
                      >
                        + 新增持股明細
                      </button>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-bold transition-colors shadow-sm cursor-pointer"
                        >
                          取消
                        </button>
                        <button
                          onClick={handleSaveSecurities}
                          disabled={isSaving}
                          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                        >
                          {isSaving ? "儲存中..." : "儲存本月股票庫存"}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div className="bg-white rounded-2xl border border-slate-100 p-6 flex flex-col items-center justify-center text-slate-400 min-h-[400px]">
                  <div className="font-bold text-sm">請在左側選擇一個證券帳戶，或點擊「投資總覽」查看彙總。</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

