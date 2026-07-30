import { useState, useEffect } from "react";
import {
  listPriceAlerts,
  createPriceAlert,
  cancelPriceAlert,
  PriceAlert,
} from "../services/api";
import { formatUtc8 } from "../utils/formatters";

const STATUS_LABEL: Record<PriceAlert["status"], string> = {
  active: "監控中",
  filled: "已成交",
  failed: "失敗",
  cancelled: "已取消",
};

const STATUS_STYLE: Record<PriceAlert["status"], string> = {
  active: "bg-blue-50 text-blue-700 border-blue-200",
  filled: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

export default function PriceAlertsPage() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [ticker, setTicker] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [targetPrice, setTargetPrice] = useState("");
  const [quantity, setQuantity] = useState("");

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listPriceAlerts();
      setAlerts(res.alerts);
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || "載入到價提醒資料失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim() || !targetPrice || !quantity) {
      setToastMsg("⚠️ 請填寫股票代號、目標價與股數");
      return;
    }
    setSubmitting(true);
    try {
      await createPriceAlert({
        ticker: ticker.trim().toUpperCase(),
        side,
        target_price: Number(targetPrice),
        quantity: Number(quantity),
      });
      setToastMsg("✅ 已建立到價自動下單監控");
      setTicker("");
      setTargetPrice("");
      setQuantity("");
      fetchData();
    } catch (err: any) {
      setToastMsg(`❌ 建立失敗: ${err.response?.data?.detail || err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: number) => {
    try {
      await cancelPriceAlert(id);
      setToastMsg("⏸️ 已取消該筆監控");
      fetchData();
    } catch (err: any) {
      setToastMsg(`❌ 取消失敗: ${err.response?.data?.detail || err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {toastMsg && (
        <div className="p-4 rounded-2xl bg-slate-900 text-white text-sm font-medium shadow-lg flex justify-between items-center animate-in fade-in duration-200">
          <span>{toastMsg}</span>
          <button onClick={() => setToastMsg(null)} className="text-slate-400 hover:text-white font-bold text-xs ml-4 cursor-pointer">
            關閉
          </button>
        </div>
      )}

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-black text-slate-900 tracking-tight">到價自動下單（玉山證券）</h1>
          <span className="bg-slate-100 text-slate-700 text-xs font-bold px-2.5 py-0.5 rounded-full border border-slate-200">
            Price Alert Auto-Trade
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          設定目標價後，系統會在台股盤中時段（09:00–13:30，一至五）每分鐘檢查一次現價；買進條件為現價 ≤ 目標價，賣出條件為現價 ≥ 目標價。
          觸發後會以目標價作為限價自動送出委託單（現股、整股），並寄信通知結果；每筆監控僅會觸發一次。
        </p>
      </div>

      <form onSubmit={handleCreate} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <h3 className="font-extrabold text-sm text-slate-800 border-b border-slate-100 pb-2">新增目標價監控</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">股票代號</label>
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="2330"
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono focus:outline-none focus:border-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">方向</label>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as "buy" | "sell")}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
            >
              <option value="buy">買進</option>
              <option value="sell">賣出</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">目標價（限價）</label>
            <input
              type="number"
              step="0.01"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              placeholder="600.00"
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">股數</label>
            <input
              type="number"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="1000"
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
              required
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-1.5 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-300 cursor-pointer"
          >
            {submitting ? "建立中..." : "建立監控"}
          </button>
        </div>
      </form>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-extrabold text-sm text-slate-900">監控列表</h3>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center text-slate-500 text-xs font-medium gap-3">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            載入中...
          </div>
        ) : error ? (
          <div className="p-6 text-rose-700 text-xs">{error}</div>
        ) : alerts.length === 0 ? (
          <div className="p-6 text-slate-400 text-xs font-medium">尚未建立任何到價監控</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-sans text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 text-[11px]">
                  <th className="py-3 px-4">股票代號</th>
                  <th className="py-3 px-3 text-center">方向</th>
                  <th className="py-3 px-3 text-right">目標價</th>
                  <th className="py-3 px-3 text-right">股數</th>
                  <th className="py-3 px-3 text-center">狀態</th>
                  <th className="py-3 px-3">建立時間</th>
                  <th className="py-3 px-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {alerts.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-900">{a.ticker}</td>
                    <td className="py-3 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${a.side === "buy" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200"}`}>
                        {a.side === "buy" ? "買進" : "賣出"}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono">{a.target_price.toFixed(2)}</td>
                    <td className="py-3 px-3 text-right font-mono">{a.quantity.toLocaleString()}</td>
                    <td className="py-3 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${STATUS_STYLE[a.status]}`}>
                        {STATUS_LABEL[a.status]}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-[11px] text-slate-500">{formatUtc8(a.created_at, true)}</td>
                    <td className="py-3 px-3 text-center">
                      {a.status === "active" ? (
                        <button
                          onClick={() => handleCancel(a.id)}
                          className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                        >
                          取消
                        </button>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
