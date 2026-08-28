import { useState, useEffect } from "react";
import {
  listPriceAlerts,
  createPriceAlert,
  updatePriceAlert,
  cancelPriceAlert,
  PriceAlert,
  PRICE_ALERT_CURRENCIES,
} from "../services/api";
import { formatUtc8 } from "../utils/formatters";
import { toast } from "../store/useToastStore";

const STATUS_LABEL: Record<PriceAlert["status"], string> = {
  active: "監控中",
  filled: "已成交/已通知",
  failed: "失敗",
  cancelled: "已取消",
};

const STATUS_STYLE: Record<PriceAlert["status"], string> = {
  active: "bg-blue-50 text-blue-700 border-blue-200",
  filled: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

const BROKER_LABEL: Record<string, string> = {
  esun: "玉山證券",
  taishin: "台新",
  sinopac: "永豐金（尚未支援）",
};

type Tab = "auto_trade" | "notify";

const FX_TICKER_PATTERN = /^([A-Z]{3})TWD=X$/;
const FX_CURRENCIES = PRICE_ALERT_CURRENCIES.filter((c) => c !== "TWD");

function fxTickerFor(currency: string): string {
  return `${currency}TWD=X`;
}

function fxLabelFor(ticker: string): string | null {
  const m = ticker.match(FX_TICKER_PATTERN);
  return m ? `${m[1]}/TWD` : null;
}

export default function PriceAlertsPage() {
  const [tab, setTab] = useState<Tab>("auto_trade");
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // auto_trade form state
  const [editingAutoId, setEditingAutoId] = useState<number | null>(null);
  const [ticker, setTicker] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [broker, setBroker] = useState<"esun" | "taishin" | "sinopac">("esun");
  const [targetPrice, setTargetPrice] = useState("");
  const [quantity, setQuantity] = useState("");

  // notify form state
  const [editingNotifyId, setEditingNotifyId] = useState<number | null>(null);
  const [notifyAssetType, setNotifyAssetType] = useState<"stock" | "fx">("stock");
  const [notifyTicker, setNotifyTicker] = useState("");
  const [notifyFxCurrency, setNotifyFxCurrency] = useState<string>(FX_CURRENCIES[0] ?? "USD");
  const [notifyCondition, setNotifyCondition] = useState<"target_price" | "ma20">("target_price");
  const [notifyDirection, setNotifyDirection] = useState<"above" | "below">("above");
  const [notifyTargetPrice, setNotifyTargetPrice] = useState("");
  const [notifyCurrency, setNotifyCurrency] = useState("TWD");

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

  const handleCreateAutoTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim() || !targetPrice || !quantity) {
      toast.warning("請填寫股票代號、目標價與股數");
      return;
    }
    if (broker === "sinopac") {
      toast.warning("永豐金尚未支援自動下單");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ticker: ticker.trim().toUpperCase(),
        alert_type: "auto_trade" as const,
        side,
        broker,
        target_price: Number(targetPrice),
        quantity: Number(quantity),
      };
      if (editingAutoId != null) {
        await updatePriceAlert(editingAutoId, payload);
        toast.success("已更新監控條件");
      } else {
        await createPriceAlert(payload);
        toast.success("已建立到價自動下單監控");
      }
      setEditingAutoId(null);
      setTicker("");
      setTargetPrice("");
      setQuantity("");
      fetchData();
    } catch (err: any) {
      toast.error(`${editingAutoId != null ? "更新" : "建立"}失敗: ${err.response?.data?.detail || err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditAutoTrade = (a: PriceAlert) => {
    setEditingAutoId(a.id);
    setTicker(a.ticker);
    setSide(a.side ?? "buy");
    setBroker(a.broker ?? "esun");
    setTargetPrice(String(a.target_price));
    setQuantity(String(a.quantity ?? ""));
  };

  const cancelEditAutoTrade = () => {
    setEditingAutoId(null);
    setTicker("");
    setTargetPrice("");
    setQuantity("");
  };

  const handleCreateNotify = async (e: React.FormEvent) => {
    e.preventDefault();
    const isFx = notifyAssetType === "fx";
    if ((!isFx && !notifyTicker.trim()) || (notifyCondition === "target_price" && !notifyTargetPrice)) {
      toast.warning(isFx ? "請填寫匯率目標值" : "請填寫股票代號與目標價");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ticker: isFx ? fxTickerFor(notifyFxCurrency) : notifyTicker.trim().toUpperCase(),
        name: isFx ? `${notifyFxCurrency}/TWD` : undefined,
        alert_type: (notifyCondition === "ma20" ? "notify_ma20" : "notify_price") as
          | "notify_ma20"
          | "notify_price",
        direction: notifyDirection,
        // MA20 alerts don't use a fixed target price; backend requires target_price > 0,
        // so pass a placeholder that's ignored for notify_ma20 comparisons.
        target_price: notifyCondition === "ma20" ? Number(notifyTargetPrice || 1) : Number(notifyTargetPrice),
        // FX rates (e.g. USDTWD=X) are always quoted in TWD per unit of foreign currency.
        currency: isFx ? "TWD" : notifyCurrency,
      };
      if (editingNotifyId != null) {
        await updatePriceAlert(editingNotifyId, payload);
        toast.success("已更新監控條件");
      } else {
        await createPriceAlert(payload);
        toast.success("已建立通知監控");
      }
      setEditingNotifyId(null);
      setNotifyTicker("");
      setNotifyTargetPrice("");
      setNotifyCurrency("TWD");
      fetchData();
    } catch (err: any) {
      toast.error(`${editingNotifyId != null ? "更新" : "建立"}失敗: ${err.response?.data?.detail || err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditNotify = (a: PriceAlert) => {
    setEditingNotifyId(a.id);
    const fxMatch = a.ticker.match(FX_TICKER_PATTERN);
    if (fxMatch) {
      setNotifyAssetType("fx");
      setNotifyFxCurrency(fxMatch[1]);
      setNotifyTicker("");
    } else {
      setNotifyAssetType("stock");
      setNotifyTicker(a.ticker);
    }
    setNotifyCondition(a.alert_type === "notify_ma20" ? "ma20" : "target_price");
    setNotifyDirection(a.direction ?? "above");
    setNotifyTargetPrice(a.alert_type === "notify_ma20" ? "" : String(a.target_price));
    setNotifyCurrency(a.currency ?? "TWD");
  };

  const cancelEditNotify = () => {
    setEditingNotifyId(null);
    setNotifyAssetType("stock");
    setNotifyTicker("");
    setNotifyTargetPrice("");
    setNotifyCurrency("TWD");
  };

  const handleCancel = async (id: number) => {
    try {
      await cancelPriceAlert(id);
      toast.info("已取消該筆監控");
      fetchData();
    } catch (err: any) {
      toast.error(`取消失敗: ${err.response?.data?.detail || err.message}`);
    }
  };

  const filteredAlerts = alerts.filter((a) =>
    tab === "auto_trade" ? a.alert_type === "auto_trade" : a.alert_type !== "auto_trade"
  );

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-black text-slate-900 tracking-tight">股價監控</h1>
        </div>
        <div className="flex gap-2 mt-4 border-b border-slate-100">
          <button
            onClick={() => setTab("auto_trade")}
            className={`px-4 py-2 text-xs font-bold border-b-2 -mb-px cursor-pointer ${
              tab === "auto_trade" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            到價自動下單
          </button>
          <button
            onClick={() => setTab("notify")}
            className={`px-4 py-2 text-xs font-bold border-b-2 -mb-px cursor-pointer ${
              tab === "notify" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            到價 / 均線通知
          </button>
        </div>
      </div>

      {tab === "auto_trade" ? (
        <>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs text-slate-500">
              設定目標價後，系統會在台股盤中時段（09:00–13:30，一至五）每分鐘檢查一次現價；買進條件為現價 ≤ 目標價，賣出條件為現價 ≥ 目標價。
              觸發後會以目標價作為限價，透過所選券商自動送出委託單（現股、整股），並寄信通知結果；每筆監控僅會觸發一次。
            </p>
          </div>

          <form onSubmit={handleCreateAutoTrade} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-extrabold text-sm text-slate-800 border-b border-slate-100 pb-2">
              {editingAutoId != null ? "編輯目標價監控" : "新增目標價監控"}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
                <label className="block text-xs font-bold text-slate-600 mb-1">券商</label>
                <select
                  value={broker}
                  onChange={(e) => setBroker(e.target.value as "esun" | "taishin" | "sinopac")}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                >
                  <option value="esun">玉山證券</option>
                  <option value="taishin">台新</option>
                  <option value="sinopac" disabled>
                    永豐金（尚未支援）
                  </option>
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
            <div className="flex justify-end gap-2">
              {editingAutoId != null && (
                <button
                  type="button"
                  onClick={cancelEditAutoTrade}
                  className="px-4 py-1.5 text-xs font-bold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  取消編輯
                </button>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-300 cursor-pointer"
              >
                {submitting ? "儲存中..." : editingAutoId != null ? "儲存變更" : "建立監控"}
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs text-slate-500">
              純通知模式不會下單，只會在觸發時寄信提醒。支援台股（TWD）與美股等外幣標的（USD 等），也支援匯率提醒（如 USD/TWD）：
              股票/ETF 於對應盤中時段每分鐘檢查一次現價，匯率則全天候每分鐘檢查一次；MA20 均線提醒則在每日台股收盤後（約 13:31）用當日收盤價與 20 日均線比較一次。
              目標價請輸入該標的原幣別的金額（例如美股請輸入美金金額並選擇 USD），匯率提醒的目標值一律以台幣計價。每筆監控僅會觸發一次。
            </p>
          </div>

          <form onSubmit={handleCreateNotify} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-extrabold text-sm text-slate-800 border-b border-slate-100 pb-2">
              {editingNotifyId != null ? "編輯通知監控" : "新增通知監控"}
            </h3>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">監控標的類型</label>
              <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 w-fit">
                <button
                  type="button"
                  onClick={() => setNotifyAssetType("stock")}
                  className={`rounded-lg px-4 py-1 text-xs font-bold transition-colors cursor-pointer ${
                    notifyAssetType === "stock" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  股票 / ETF
                </button>
                <button
                  type="button"
                  onClick={() => setNotifyAssetType("fx")}
                  className={`rounded-lg px-4 py-1 text-xs font-bold transition-colors cursor-pointer ${
                    notifyAssetType === "fx" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  匯率
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {notifyAssetType === "stock" ? (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">股票代號</label>
                  <input
                    type="text"
                    value={notifyTicker}
                    onChange={(e) => setNotifyTicker(e.target.value)}
                    placeholder="2330"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">貨幣對（兌台幣）</label>
                  <select
                    value={notifyFxCurrency}
                    onChange={(e) => setNotifyFxCurrency(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    {FX_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}/TWD
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">通知條件</label>
                <select
                  value={notifyCondition}
                  onChange={(e) => setNotifyCondition(e.target.value as "target_price" | "ma20")}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                >
                  <option value="target_price">到價提醒</option>
                  <option value="ma20">MA20 均線</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">方向</label>
                <select
                  value={notifyDirection}
                  onChange={(e) => setNotifyDirection(e.target.value as "above" | "below")}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                >
                  <option value="above">漲破</option>
                  <option value="below">跌破</option>
                </select>
              </div>
              {notifyCondition === "target_price" && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    {notifyAssetType === "fx" ? "目標匯率（TWD）" : "目標價"}
                  </label>
                  <div className="flex gap-2">
                    {notifyAssetType === "fx" ? (
                      <span className="px-2 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-500 bg-slate-50">
                        TWD
                      </span>
                    ) : (
                      <select
                        value={notifyCurrency}
                        onChange={(e) => setNotifyCurrency(e.target.value)}
                        className="px-2 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                      >
                        {PRICE_ALERT_CURRENCIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      type="number"
                      step="0.01"
                      value={notifyTargetPrice}
                      onChange={(e) => setNotifyTargetPrice(e.target.value)}
                      placeholder="600.00"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              {editingNotifyId != null && (
                <button
                  type="button"
                  onClick={cancelEditNotify}
                  className="px-4 py-1.5 text-xs font-bold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  取消編輯
                </button>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-300 cursor-pointer"
              >
                {submitting ? "儲存中..." : editingNotifyId != null ? "儲存變更" : "建立監控"}
              </button>
            </div>
          </form>
        </>
      )}

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
        ) : filteredAlerts.length === 0 ? (
          <div className="p-6 text-slate-400 text-xs font-medium">尚未建立任何監控</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-sans text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 text-[11px]">
                  <th className="py-3 px-4">監控標的</th>
                  {tab === "auto_trade" ? (
                    <>
                      <th className="py-3 px-3 text-center">方向</th>
                      <th className="py-3 px-3 text-center">券商</th>
                      <th className="py-3 px-3 text-right">目標價</th>
                      <th className="py-3 px-3 text-right">股數</th>
                    </>
                  ) : (
                    <>
                      <th className="py-3 px-3 text-center">條件類型</th>
                      <th className="py-3 px-3 text-center">方向</th>
                      <th className="py-3 px-3 text-right">目標價</th>
                    </>
                  )}
                  <th className="py-3 px-3 text-center">狀態</th>
                  <th className="py-3 px-3">建立時間</th>
                  <th className="py-3 px-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {filteredAlerts.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-900">{fxLabelFor(a.ticker) ?? a.ticker}</td>
                    {tab === "auto_trade" ? (
                      <>
                        <td className="py-3 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${a.side === "buy" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200"}`}>
                            {a.side === "buy" ? "買進" : "賣出"}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center text-[11px]">{a.broker ? BROKER_LABEL[a.broker] : "-"}</td>
                        <td className="py-3 px-3 text-right font-mono whitespace-nowrap">{a.target_price.toFixed(2)}</td>
                        <td className="py-3 px-3 text-right font-mono whitespace-nowrap">{a.quantity?.toLocaleString() ?? "-"}</td>
                      </>
                    ) : (
                      <>
                        <td className="py-3 px-3 text-center text-[11px]">
                          {a.alert_type === "notify_ma20" ? "MA20 均線" : "到價提醒"}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${a.direction === "above" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200"}`}>
                            {a.direction === "above" ? "漲破" : "跌破"}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                          {a.alert_type === "notify_ma20" ? "-" : `${a.currency} ${a.target_price.toFixed(2)}`}
                        </td>
                      </>
                    )}
                    <td className="py-3 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${STATUS_STYLE[a.status]}`}>
                        {STATUS_LABEL[a.status]}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-[11px] text-slate-500">{formatUtc8(a.created_at, true)}</td>
                    <td className="py-3 px-3 text-center">
                      {a.status === "active" ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => (tab === "auto_trade" ? handleEditAutoTrade(a) : handleEditNotify(a))}
                            className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                          >
                            編輯
                          </button>
                          <button
                            onClick={() => handleCancel(a.id)}
                            className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                          >
                            取消
                          </button>
                        </div>
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
