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
        <h4 className="font-bold text-sm mb-1">❌ 載入失敗</h4>
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
          <button onClick={() => setToastMsg(null)} className="text-slate-400 hover:text-white font-bold text-xs ml-4">
            關閉
          </button>
        </div>
      )}

      {/* Header Bar matching system pages */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black text-slate-900 tracking-tight">資產再平衡策略</h1>
            <span className="bg-blue-50 text-blue-700 text-xs font-bold px-2.5 py-0.5 rounded-full border border-blue-200/60">
              Portfolio Rebalance
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            根據目標比例與雙向警戒門檻（上漲過高或下跌過低）自動試算交易動作，協助保持最佳資產配置。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEditingSettings(!isEditingSettings)}
            className="px-3.5 py-2 text-xs font-bold rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
          >
            {isEditingSettings ? "關閉設定" : "⚙️ 策略參數設定"}
          </button>

          <button
            onClick={handleSendEmail}
            disabled={sendingEmail}
            className="px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
          >
            {sendingEmail ? "寄送中..." : "📧 發送提醒郵件"}
          </button>
        </div>
      </div>

      {/* Alert Banner System Style */}
      {analysis && (
        <div
          className={`p-4 rounded-2xl border flex items-start gap-3 transition-all ${
            analysis.is_triggered
              ? "bg-rose-50 border-rose-200 text-rose-900"
              : "bg-emerald-50 border-emerald-200 text-emerald-900"
          }`}
        >
          <span className="text-xl">{analysis.is_triggered ? "⚠️" : "✅"}</span>
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
                ? `股票部位表現亮眼，建議獲利解結部分股票並充實債券與現金金庫。您可點擊右上方發送通知信。`
                : analysis.trigger_direction === "FALL"
                ? `股票部位回檔修正，建議逢低買進加碼股票部位並釋出部分債券或現金。您可點擊右上方發送通知信。`
                : `當前資產分配符合策略目標區間，無須調整。`}
            </p>
          </div>
        </div>
      )}

      {/* Settings Form Card */}
      {isEditingSettings && (
        <form onSubmit={handleSaveSettings} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 animate-in fade-in duration-200">
          <h3 className="font-extrabold text-sm text-slate-800 pb-2 border-b border-slate-100">
            ⚙️ 調整策略目標比例與雙向警戒門檻
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
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">現金部位</span>
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

      {/* Main Rebalance Calculation Table with System Palette */}
      {analysis && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
            <div>
              <h3 className="font-extrabold text-sm text-slate-900">📊 再平衡交易試算表</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                依照精確公式試算各標的需調整交易金額、股數與再平衡後預估市值。
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
                  <th className="py-3 px-3 text-center">類別</th>
                  <th className="py-3 px-3 text-right">目前股數</th>
                  <th className="py-3 px-3 text-right bg-slate-100/70 text-slate-900">預計比例</th>
                  <th className="py-3 px-3 text-right">現價 (TWD)</th>
                  <th className="py-3 px-3 text-right">總市值</th>
                  <th className="py-3 px-3 text-right">實際比例</th>
                  <th className="py-3 px-3 text-right bg-indigo-50 text-indigo-900 font-extrabold">
                    需交易金額
                  </th>
                  <th className="py-3 px-3 text-right bg-indigo-50 text-indigo-900 font-extrabold">
                    交易股數
                  </th>
                  <th className="py-3 px-3 text-right">再平衡後股數</th>
                  <th className="py-3 px-3 text-right">再平衡後市值</th>
                  <th className="py-3 px-3 text-right">再平衡後佔比</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {analysis.rebalance_items.map((item, idx) => {
                  const isSell = item.trade_amount < 0;
                  const isBuy = item.trade_amount > 0;

                  return (
                    <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                      {/* 標的 */}
                      <td className="py-3 px-4 font-bold flex items-center gap-1.5">
                        <span className="text-sm">{item.category === "CASH" ? "💵" : item.category === "BOND" ? "🛡️" : "📈"}</span>
                        <span>{item.ticker}</span>
                        {item.name !== item.ticker && <span className="text-[11px] text-slate-400 font-normal">({item.name})</span>}
                      </td>

                      {/* 類別 */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
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
                      <td className="py-3 px-3 text-right font-mono">
                        {item.category === "CASH" ? "-" : formatMoney(item.quantity)}
                      </td>

                      {/* 預計比例 */}
                      <td className="py-3 px-3 text-right font-mono font-bold bg-slate-50/80 text-slate-800">
                        {item.target_pct.toFixed(2)}%
                      </td>

                      {/* 現價 */}
                      <td className="py-3 px-3 text-right font-mono">
                        {item.category === "CASH" ? "-" : item.current_price.toFixed(2)}
                      </td>

                      {/* 總市值 */}
                      <td className="py-3 px-3 text-right font-mono font-bold">
                        NT$ {formatMoney(item.current_market_value)}
                      </td>

                      {/* 實際比例 */}
                      <td className="py-3 px-3 text-right font-mono">
                        {item.actual_pct.toFixed(2)}%
                      </td>

                      {/* 需交易金額 */}
                      <td
                        className={`py-3 px-3 text-right font-mono font-extrabold ${
                          isSell
                            ? "text-rose-600 bg-rose-50/50"
                            : isBuy
                            ? "text-emerald-600 bg-emerald-50/50"
                            : "text-slate-400"
                        }`}
                      >
                        {isSell ? `- NT$ ${formatMoney(Math.abs(item.trade_amount))}` : isBuy ? `+ NT$ ${formatMoney(item.trade_amount)}` : "NT$ 0"}
                      </td>

                      {/* 交易股數 */}
                      <td
                        className={`py-3 px-3 text-right font-mono font-extrabold ${
                          isSell
                            ? "text-rose-600 bg-rose-50/50"
                            : isBuy
                            ? "text-emerald-600 bg-emerald-50/50"
                            : "text-slate-400"
                        }`}
                      >
                        {item.category === "CASH"
                          ? "-"
                          : isSell
                          ? `- ${formatMoney(Math.abs(item.trade_shares))}`
                          : isBuy
                          ? `+ ${formatMoney(item.trade_shares)}`
                          : "0"}
                      </td>

                      {/* 再平衡後實際股數 */}
                      <td className="py-3 px-3 text-right font-mono">
                        {item.category === "CASH" ? "-" : formatMoney(item.post_rebalance_shares)}
                      </td>

                      {/* 再平衡後市值 */}
                      <td className="py-3 px-3 text-right font-mono font-bold">
                        NT$ {formatMoney(item.post_rebalance_market_value)}
                      </td>

                      {/* 再平衡後佔比 */}
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-800">
                        {item.post_rebalance_pct.toFixed(2)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
