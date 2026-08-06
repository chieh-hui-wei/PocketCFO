import { useSearchParams } from "react-router-dom";
import StockHoldingsPage from "./StockHoldingsPage";
import StockTransactionsPage from "./StockTransactionsPage";
import RebalancePage from "./RebalancePage";

type StockTab = "holdings" | "transactions" | "rebalance";

const TABS: Array<{ key: StockTab; label: string }> = [
  { key: "holdings", label: "庫存" },
  { key: "transactions", label: "交易明細" },
  { key: "rebalance", label: "再平衡" },
];

export default function StockPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: StockTab = rawTab === "transactions" || rawTab === "rebalance" ? rawTab : "holdings";

  const setActiveTab = (tab: StockTab) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">股票</h1>
          <p className="text-sm text-slate-500 mt-1">跨券商股票持股彙總、交易明細與資產再平衡策略</p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-inner">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`rounded-lg px-4 py-1.5 text-xs font-extrabold transition-all duration-200 cursor-pointer ${
                activeTab === t.key
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200/50"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "holdings" && <StockHoldingsPage />}
      {activeTab === "transactions" && <StockTransactionsPage />}
      {activeTab === "rebalance" && <RebalancePage />}
    </div>
  );
}
