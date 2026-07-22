import { useState, useEffect } from "react";
import {
  getRebalanceAnalysis,
  updateRebalanceSettings,
  sendRebalanceAlertEmail,
  RebalanceAnalysis,
} from "../services/api";

export default function RebalancePage() {
  const [analysis, setAnalysis] = useState<RebalanceAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Edit Settings state
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [targetStock, setTargetStock] = useState(50);
  const [targetBond, setTargetBond] = useState(10);
  const [targetCash, setTargetCash] = useState(40);
  const [triggerThreshold, setTriggerThreshold] = useState(60);
  const [targetMinStock, setTargetMinStock] = useState(40);
  const [bondTickers, setBondTickers] = useState("00931B,BND");
  const [customCash, setCustomCash] = useState<string>("");
  const [savingSettings, setSavingSettings] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getRebalanceAnalysis();
      setAnalysis(res);
      setTargetStock(res.target_stock_pct);
      setTargetBond(res.target_bond_pct);
      setTargetCash(res.target_cash_pct);
      setTriggerThreshold(res.stock_trigger_threshold);
      setTargetMinStock(res.stock_min_threshold || 40);
      setBondTickers(res.bond_tickers);
      setCustomCash(res.custom_cash_amount != null ? String(res.custom_cash_amount) : "");
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || "載入再平衡資料失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const sum = Number(targetStock) + Number(targetBond) + Number(targetCash);
    if (Math.abs(sum - 100) > 0.01) {
      setToastMsg("⚠️ 股票、債券與現金的預計比例加總必須等於 100%");
      return;
    }

    setSavingSettings(true);
    try {
      await updateRebalanceSettings({
        target_stock_pct: Number(targetStock),
        target_bond_pct: Number(targetBond),
        target_cash_pct: Number(targetCash),
        stock_trigger_threshold: Number(triggerThreshold),
        stock_min_threshold: Number(targetMinStock),
        bond_tickers: bondTickers,
        custom_cash_amount: customCash.trim() !== "" ? Number(customCash) : -1,
      });
      setToastMsg("✅ 再平衡策略設定已更新");
      setIsEditingSettings(false);
      fetchData();
    } catch (err: any) {
      setToastMsg(`❌ 儲存失敗: ${err.response?.data?.detail || err.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSendEmail = async () => {
    setSendingEmail(true);
    try {
      const res = await sendRebalanceAlertEmail();
      setToastMsg(`📧 再平衡提醒信件已成功寄送至 ${res.sent_to}`);
    } catch (err: any) {
      setToastMsg(`❌ 寄送失敗: ${err.response?.data?.detail || err.message}`);
    } finally {
      setSendingEmail(false);
    }
  };

  const formatMoney = (val: number) => {
    return val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  const handleToggleAutoEmail = async () => {
    if (!analysis) return;
    const newStatus = !analysis.enable_email_alert;
    try {
      await updateRebalanceSettings({ enable_email_alert: newStatus });
      setToastMsg(newStatus ? "✅ 已開啟資產偏離「自動郵件提醒」" : "⏸️ 已關閉「自動郵件提醒」");
      fetchData();
    } catch (err: any) {
      setToastMsg(`❌ 設定更新失敗: ${err.response?.data?.detail || err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-slate-500 font-medium">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          正在計算動態資產再平衡數據...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-rose-900 text-xs">
        <h4 className="font-bold text-sm mb-1">載入失敗</h4>
        <p>{error}</p>
        <button
          onClick={fetchData}
          className="mt-3 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg cursor-pointer"
        >
          重新試驗
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification Banner */}
      {toastMsg && (
        <div className="p-4 rounded-2xl bg-slate-900 text-white text-sm font-medium shadow-lg flex justify-between items-center animate-in fade-in duration-200">
          <span>{toastMsg}</span>
          <button onClick={() => setToastMsg(null)} className="text-slate-400 hover:text-white font-bold text-xs ml-4 cursor-pointer">
            關閉
          </button>
        </div>
      )}

      {/* Header Bar */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black text-slate-900 tracking-tight">資產再平衡策略</h1>
            <span className="bg-slate-100 text-slate-700 text-xs font-bold px-2.5 py-0.5 rounded-full border border-slate-200">
              Portfolio Rebalance
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            根據目標比例與雙向警戒門檻（上漲過高或下跌過低）自動試算交易動作，協助保持最佳資產配置。
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto Email Alert Toggle Switch */}
          {analysis && (
            <button
              type="button"
              onClick={handleToggleAutoEmail}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl border flex items-center gap-2 transition-all cursor-pointer ${
                analysis.enable_email_alert
                  ? "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                  : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
              }`}
            >
              <div
                className={`w-8 h-4 rounded-full p-0.5 transition-colors ${
                  analysis.enable_email_alert ? "bg-emerald-600" : "bg-slate-300"
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full bg-white transition-transform ${
                    analysis.enable_email_alert ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </div>
              <span>
                {analysis.enable_email_alert ? "自動郵件提醒：已開啟" : "自動郵件提醒：已關閉"}
              </span>
            </button>
          )}

          <button
            onClick={() => setIsEditingSettings(!isEditingSettings)}
            className="px-3.5 py-2 text-xs font-bold rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
          >
            {isEditingSettings ? "關閉設定" : "策略參數設定"}
          </button>

          <button
            onClick={handleSendEmail}
            disabled={sendingEmail}
            className="px-3.5 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white shadow-sm transition-colors cursor-pointer"
          >
            {sendingEmail ? "寄送中..." : "手動測試寄信"}
          </button>
        </div>
      </div>

      {/* Status Alert Banner */}
      {analysis && (
        <div
          className={`p-4 rounded-2xl border flex items-start gap-3 transition-all ${
            analysis.is_triggered
              ? "bg-rose-50 border-rose-200 text-rose-900"
              : "bg-emerald-50 border-emerald-200 text-emerald-900"
          }`}
        >
          <div className="flex-1 text-xs leading-relaxed">
            <h4 className="font-extrabold text-sm mb-0.5">
              {analysis.trigger_direction === "RISE"
                ? `股票佔比為 ${analysis.current_stock_pct}%（已上漲觸發上限警戒門檻 ≥ ${analysis.stock_trigger_threshold}%）`
                : analysis.trigger_direction === "FALL"
                ? `股票佔比為 ${analysis.current_stock_pct}%（已下跌觸發下限警戒門檻 ≤ ${analysis.stock_min_threshold}%）`
                : `資產配置正常：股票佔比 ${analysis.current_stock_pct}%（正常範圍 ${analysis.stock_min_threshold}% ~ ${analysis.stock_trigger_threshold}%）`}
            </h4>
            <p className="opacity-90">
              {analysis.trigger_direction === "RISE"
                ? `股票部位表現亮眼，建議獲利解結部分股票部位並充實債券與現金金庫。您可以參考下方「建議調整動作」進行交易。`
                : analysis.trigger_direction === "FALL"
                ? `股票部位回檔修正，建議逢低買進加碼股票部位並釋出部分債券或現金。您可以參考下方「建議調整動作」進行交易。`
                : `當前資產分配符合策略目標區間，無須調整。`}
            </p>
          </div>
        </div>
      )}

      {/* Settings Form Card */}
      {isEditingSettings && (
        <form onSubmit={handleSaveSettings} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 animate-in fade-in duration-200">
          <h3 className="font-extrabold text-sm text-slate-800 pb-2 border-b border-slate-100">
            調整策略目標比例與雙向警戒門檻
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">目標股票佔比 (%)</label>
              <input
                type="number"
                step="1"
                value={targetStock}
                onChange={(e) => setTargetStock(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">目標債券佔比 (%)</label>
              <input
                type="number"
                step="1"
                value={targetBond}
                onChange={(e) => setTargetBond(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">目標現金佔比 (%)</label>
              <input
                type="number"
                step="1"
                value={targetCash}
                onChange={(e) => setTargetCash(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">股票下限門檻 (下跌% Trigger)</label>
              <input
                type="number"
                step="1"
                value={targetMinStock}
                onChange={(e) => setTargetMinStock(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">股票上限門檻 (上漲% Trigger)</label>
              <input
                type="number"
                step="1"
                value={triggerThreshold}
                onChange={(e) => setTriggerThreshold(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">債券標的代號清單 (以逗號分隔)</label>
              <input
                type="text"
                value={bondTickers}
                onChange={(e) => setBondTickers(e.target.value)}
                placeholder="00931B,BND"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono focus:outline-none focus:border-blue-500"
                required
              />
              <p className="text-[11px] text-slate-400 mt-1">
                系統將依此代號自動將庫存分類為債券部位，其餘股票預設分類為股票部位。
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">
                自訂當前現金總額 TWD (選填)
              </label>
              <input
                type="number"
                step="100"
                value={customCash}
                onChange={(e) => setCustomCash(e.target.value)}
                placeholder="留空則自動採用對帳單/上月結餘"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                若當月尚未匯入對帳單，填寫此處可即時覆蓋目前最新現金總額進行精確再平衡。
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsEditingSettings(false)}
              className="px-4 py-1.5 text-xs font-bold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={savingSettings}
              className="px-4 py-1.5 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-300 cursor-pointer"
            >
              {savingSettings ? "儲存中..." : "儲存設定"}
            </button>
          </div>
        </form>
      )}

      {/* Asset Overview Cards */}
      {analysis && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">總投資組合價值</div>
            <div className="text-xl font-black text-slate-900 mt-1">NT$ {formatMoney(analysis.total_portfolio_value)}</div>
            <div className="text-[11px] text-slate-500 mt-1">含股票、債券與現金</div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">股票部位</span>
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                目標 {analysis.target_stock_pct}%
              </span>
            </div>
            <div className="text-xl font-black text-slate-900 mt-1">NT$ {formatMoney(analysis.stock_market_value)}</div>
            <div className="text-xs font-bold text-slate-600 mt-1">
              實際佔比: <span className={analysis.current_stock_pct >= analysis.stock_trigger_threshold ? "text-rose-600 font-extrabold" : "text-emerald-600"}>{analysis.current_stock_pct}%</span>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">債券部位</span>
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                目標 {analysis.target_bond_pct}%
              </span>
            </div>
            <div className="text-xl font-black text-slate-900 mt-1">NT$ {formatMoney(analysis.bond_market_value)}</div>
            <div className="text-xs font-bold text-slate-600 mt-1">
              實際佔比: <span className="text-blue-600">{analysis.current_bond_pct}%</span>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                現金部位
                {analysis.is_custom_cash ? (
                  <span className="text-[9px] font-extrabold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded">手動指定</span>
                ) : (
                  <span className="text-[9px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">對帳單快照</span>
                )}
              </span>
              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                目標 {analysis.target_cash_pct}%
              </span>
            </div>
            <div className="text-xl font-black text-slate-900 mt-1">NT$ {formatMoney(analysis.cash_market_value)}</div>
            <div className="text-xs font-bold text-slate-600 mt-1">
              實際佔比: <span className="text-amber-600">{analysis.current_cash_pct}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Clean Rebalance Portfolio Table */}
      {analysis && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
            <div>
              <h3 className="font-extrabold text-sm text-slate-900">資產部位明細表</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                檢視各標的當前庫存數量、現價、總市值、預計比例與實際比例。
              </p>
            </div>
            <span className="text-xs font-mono bg-slate-100 text-slate-600 px-3 py-1 rounded-full font-bold">
              {analysis.period_date}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-sans text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 text-[11px]">
                  <th className="py-3 px-4">標的 / 資產</th>
                  <th className="py-3 px-3 text-center w-20 whitespace-nowrap">類別</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">目前股數</th>
                  <th className="py-3 px-3 text-right bg-slate-100/70 text-slate-900 whitespace-nowrap">預計比例</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">現價 (TWD)</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">總市值</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">實際比例</th>
                  <th className="py-3 px-3 text-center whitespace-nowrap">再平衡狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {analysis.rebalance_items.map((item, idx) => {
                  const isSell = item.trade_amount < 0;
                  const isBuy = item.trade_amount > 0;

                  return (
                    <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                      {/* 標的 */}
                      <td className="py-3.5 px-4 font-bold">
                        <span className="text-slate-900">{item.ticker}</span>
                        {item.name !== item.ticker && <span className="text-[11px] text-slate-400 font-normal ml-1">({item.name})</span>}
                      </td>

                      {/* 類別 */}
                      <td className="py-3.5 px-3 text-center w-20 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold inline-block whitespace-nowrap ${
                            item.category === "STOCK"
                              ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
                              : item.category === "BOND"
                              ? "bg-blue-50 text-blue-700 border border-blue-100"
                              : "bg-amber-50 text-amber-800 border border-amber-100"
                          }`}
                        >
                          {item.category === "STOCK" ? "股票" : item.category === "BOND" ? "債券" : "現金"}
                        </span>
                      </td>

                      {/* 股數 */}
                      <td className="py-3.5 px-3 text-right font-mono whitespace-nowrap">
                        {item.category === "CASH" ? "-" : formatMoney(item.quantity)}
                      </td>

                      {/* 預計比例 */}
                      <td className="py-3.5 px-3 text-right font-mono font-bold bg-slate-50/80 text-slate-800 whitespace-nowrap">
                        {item.target_pct.toFixed(2)}%
                      </td>

                      {/* 現價 */}
                      <td className="py-3.5 px-3 text-right font-mono whitespace-nowrap">
                        {item.category === "CASH" ? "-" : item.current_price.toFixed(2)}
                      </td>

                      {/* 總市值 */}
                      <td className="py-3.5 px-3 text-right font-mono font-bold whitespace-nowrap">
                        NT$ {formatMoney(item.current_market_value)}
                      </td>

                      {/* 實際比例 */}
                      <td className="py-3.5 px-3 text-right font-mono whitespace-nowrap">
                        {item.actual_pct.toFixed(2)}%
                      </td>

                      {/* 再平衡狀態 */}
                      <td className="py-3.5 px-3 text-center whitespace-nowrap">
                        {isSell ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">
                            需減碼賣出
                          </span>
                        ) : isBuy ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                            需逢低加碼
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500">
                            符合配置
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Suggested Trade Actions (Positioned below table, distinguished by Sell vs Buy) */}
      {analysis && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-extrabold text-sm text-slate-900">建議調整動作 (Suggested Trade Actions)</h3>
              <p className="text-xs text-slate-500 mt-0.5">依目標比例區分為「建議減碼賣出」與「建議逢低加碼」之試算金額</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* 建議減碼賣出 (Sell Items) */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                <h4 className="text-xs font-extrabold text-rose-900">建議減碼賣出 (Sell / Profit Taking)</h4>
              </div>

              {analysis.rebalance_items.filter((i) => i.trade_amount < 0).length === 0 ? (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-slate-400 text-xs font-medium">
                  目前無須減碼之標的部位
                </div>
              ) : (
                <div className="space-y-2">
                  {analysis.rebalance_items
                    .filter((i) => i.trade_amount < 0)
                    .map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-rose-50/50 border border-rose-200/80 rounded-xl flex items-center justify-between"
                      >
                        <div>
                          <div className="font-extrabold text-xs text-slate-900">{item.ticker}</div>
                          <div className="text-[11px] text-slate-500">目前佔比 {item.actual_pct.toFixed(2)}% → 目標 {item.target_pct.toFixed(2)}%</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-black text-rose-600 font-mono">
                            - NT$ {formatMoney(Math.abs(item.trade_amount))}
                          </div>
                          <div className="text-[10px] text-rose-700 font-bold">建議減碼賣出</div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* 建議逢低加碼 (Buy Items) */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <h4 className="text-xs font-extrabold text-emerald-900">建議逢低加碼 (Buy / Rebalance In)</h4>
              </div>

              {analysis.rebalance_items.filter((i) => i.trade_amount > 0).length === 0 ? (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-slate-400 text-xs font-medium">
                  目前無須加碼之標的部位
                </div>
              ) : (
                <div className="space-y-2">
                  {analysis.rebalance_items
                    .filter((i) => i.trade_amount > 0)
                    .map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-emerald-50/50 border border-emerald-200/80 rounded-xl flex items-center justify-between"
                      >
                        <div>
                          <div className="font-extrabold text-xs text-slate-900">{item.ticker}</div>
                          <div className="text-[11px] text-slate-500">目前佔比 {item.actual_pct.toFixed(2)}% → 目標 {item.target_pct.toFixed(2)}%</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-black text-emerald-600 font-mono">
                            + NT$ {formatMoney(item.trade_amount)}
                          </div>
                          <div className="text-[10px] text-emerald-700 font-bold">建議買進加碼</div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
