import { useState } from "react";
import {
  parseStatement,
  confirmStatement,
  StatementKind,
} from "../services/api";

const KINDS = [
  { id: "bank", num: 1, title: "銀行對帳單", sub: "請上傳您的銀行對帳單", ext: "僅限 PDF 檔案" },
  { id: "credit_card", num: 2, title: "信用卡對帳單", sub: "請上傳您的信用卡帳單", ext: "僅限 PDF 檔案" },
  { id: "brokerage", num: 3, title: "證券對帳單", sub: "請上傳您的證券對帳單", ext: "僅限 PDF 檔案" },
  { id: "einvoice", num: 4, title: "電子發票載具清單", sub: "請上傳您的電子發票清單", ext: "僅限 PDF 檔案" },
];

export default function UploadPage() {
  const [files, setFiles] = useState<Record<string, File[]>>({
    bank: [],
    credit_card: [],
    brokerage: [],
    einvoice: [],
  });
  const [password, setPassword] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [success, setSuccess] = useState(false);

  // States for the two-step verification flow
  const [editData, setEditData] = useState<any | null>(null);
  const [activeAccountTab, setActiveAccountTab] = useState(0);

  const updateAccountField = (tabIdx: number, field: string, value: any) => {
    setEditData((prev: any) => {
      const copy = { ...prev };
      copy.accounts = [...copy.accounts];
      copy.accounts[tabIdx] = { ...copy.accounts[tabIdx], [field]: value };
      return copy;
    });
  };


  const handleFileDrop = (e: React.DragEvent, kindId: string) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFiles({ ...files, [kindId]: [...files[kindId], ...Array.from(e.dataTransfer.files)] });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, kindId: string) => {
    if (e.target.files && e.target.files.length > 0) {
      setFiles({ ...files, [kindId]: [...files[kindId], ...Array.from(e.target.files)] });
    }
  };

  const uploadedCount = Object.values(files).reduce((acc, curr) => acc + curr.length, 0);

  // STEP 1: Upload and Parse Statement
  const handleParse = async () => {
    setIsProcessing(true);
    setSuccess(false);
    setEditData(null);
    setStatusMsg("正在傳送至伺服器並解析對帳單...");

    try {
      let activeKind: StatementKind | null = null;
      let activeFile: File | null = null;

      // Find the first file selected
      for (const [kind, fileList] of Object.entries(files)) {
        if (fileList.length > 0) {
          activeKind = kind as StatementKind;
          activeFile = fileList[0];
          break;
        }
      }

      if (!activeFile || !activeKind) {
        throw new Error("請先選擇對帳單檔案");
      }

      setStatusMsg(`正在透過 Gemini AI 解析 ${activeFile.name}...`);
      const res = await parseStatement(activeFile, activeKind, undefined, password);

      // Normalise response into editable state
      const rawData = res.parsed_data || {};
      const kind = rawData.kind || activeKind;
      
      let accountsList = null;
      if (kind === "bank") {
        if (rawData.accounts) {
          accountsList = rawData.accounts.map((acc: any) => ({
            account_number: acc.account_number || "",
            currency: acc.currency || "TWD",
            exchange_rate: acc.exchange_rate || 1.0,
            closing_balance: acc.closing_balance != null ? acc.closing_balance : 0,
            transactions: (acc.transactions || []).map((t: any) => ({
              date: t.date || "",
              description: t.description || t.merchant || "",
              merchant: t.merchant || t.description || "",
              amount: t.amount != null ? t.amount : (parseFloat(t.credit || 0) - parseFloat(t.debit || 0)),
              category: t.category || "其他",
              is_refund: !!t.is_refund,
              payment_method: t.payment_method || "",
              invoice_number: t.invoice_number || "",
              action: t.action || "",
              ticker: t.ticker || "",
              quantity: t.quantity != null ? t.quantity : 0,
              price: t.price != null ? t.price : 0,
              fee: t.fee != null ? t.fee : 0
            }))
          }));
        } else {
          accountsList = [{
            account_number: rawData.account_number || "",
            currency: rawData.currency || "TWD",
            exchange_rate: rawData.exchange_rate || 1.0,
            closing_balance: rawData.closing_balance != null ? rawData.closing_balance : 0,
            transactions: (rawData.transactions || []).map((t: any) => ({
              date: t.date || "",
              description: t.description || t.merchant || "",
              merchant: t.merchant || t.description || "",
              amount: t.amount != null ? t.amount : (parseFloat(t.credit || 0) - parseFloat(t.debit || 0)),
              category: t.category || "其他",
              is_refund: !!t.is_refund,
              payment_method: t.payment_method || "",
              invoice_number: t.invoice_number || "",
              action: t.action || "",
              ticker: t.ticker || "",
              quantity: t.quantity != null ? t.quantity : 0,
              price: t.price != null ? t.price : 0,
              fee: t.fee != null ? t.fee : 0
            }))
          }];
        }
      }

      setActiveAccountTab(0);
      setEditData({
        kind,
        filename: res.filename,
        file_hash: res.file_hash,
        period_year: rawData.period_year || new Date().getFullYear(),
        period_month: rawData.period_month || (new Date().getMonth() + 1),
        institution: rawData.institution || "",
        currency: rawData.currency || "TWD",
        exchange_rate: rawData.exchange_rate || 1.0,
        account_code: rawData.account_code || "",
        account_number: rawData.account_number || "",
        card_last_four: rawData.card_last_four || "",
        closing_balance: rawData.closing_balance != null ? rawData.closing_balance : 0,
        total_amount: rawData.total_amount != null ? rawData.total_amount : 0,
        payment_due_date: rawData.payment_due_date || "",
        cash_balance: rawData.cash_balance != null ? rawData.cash_balance : 0,
        total_market_value: rawData.total_market_value != null ? rawData.total_market_value : 0,
        holdings: (rawData.holdings || []).map((h: any) => ({
          ticker: h.ticker || "",
          name: h.name || "",
          quantity: h.quantity != null ? h.quantity : 0,
          avg_cost: h.avg_cost != null ? h.avg_cost : 0,
          current_price: h.current_price != null ? h.current_price : 0,
        })),
        transactions: (rawData.transactions || rawData.items || []).map((t: any) => ({
          date: t.date || "",
          description: t.description || t.merchant || "",
          merchant: t.merchant || t.description || "",
          amount: t.amount != null ? t.amount : (parseFloat(t.credit || 0) - parseFloat(t.debit || 0)),
          category: t.category || "",
          is_refund: !!t.is_refund,
          payment_method: t.payment_method || "",
          invoice_number: t.invoice_number || "",
          action: t.action || "",
          ticker: t.ticker || "",
          quantity: t.quantity != null ? t.quantity : 0,
          price: t.price != null ? t.price : 0,
          fee: t.fee != null ? t.fee : 0
        })),
        accounts: accountsList
      });

      setSuccess(true);
      setStatusMsg("解析成功！請在右側核對並調整資料。");
    } catch (e: any) {
      console.error(e);
      setStatusMsg(`解析錯誤：${e.response?.data?.detail || e.message || "請檢查看控制台日誌。"}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // STEP 2: Save Confirmed Statement to DB
  const handleConfirm = async () => {
    if (!editData) return;
    setIsProcessing(true);
    setSuccess(false);
    setStatusMsg("正在寫入資料庫並重新計算財報，請稍候...");

    try {
      await confirmStatement(editData);
      setSuccess(true);
      setStatusMsg("資料已成功寫入資料庫並完成結算！");
      setEditData(null);
      setFiles({ bank: [], credit_card: [], brokerage: [], einvoice: [] });
      setPassword("");
    } catch (e: any) {
      console.error(e);
      setStatusMsg(`確認儲存失敗：${e.response?.data?.detail || e.message || "發生未知錯誤。"}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelReview = () => {
    setEditData(null);
    setStatusMsg("");
  };

  const updateField = (field: string, value: any) => {
    setEditData((prev: any) => ({ ...prev, [field]: value }));
  };

  const updateHolding = (index: number, field: string, value: any) => {
    setEditData((prev: any) => {
      const copy = { ...prev };
      copy.holdings = [...copy.holdings];
      copy.holdings[index] = { ...copy.holdings[index], [field]: value };
      return copy;
    });
  };

  const addHoldingRow = () => {
    setEditData((prev: any) => ({
      ...prev,
      holdings: [...(prev.holdings || []), { ticker: "", name: "", quantity: 0, avg_cost: 0, current_price: 0 }]
    }));
  };

  const removeHoldingRow = (index: number) => {
    setEditData((prev: any) => ({
      ...prev,
      holdings: prev.holdings.filter((_: any, i: number) => i !== index)
    }));
  };

  const updateTransactionRow = (index: number, field: string, value: any) => {
    setEditData((prev: any) => {
      const copy = { ...prev };
      if (copy.accounts) {
        copy.accounts = [...copy.accounts];
        const accCopy = { ...copy.accounts[activeAccountTab] };
        accCopy.transactions = [...accCopy.transactions];
        accCopy.transactions[index] = { ...accCopy.transactions[index], [field]: value };
        copy.accounts[activeAccountTab] = accCopy;
      } else {
        copy.transactions = [...copy.transactions];
        copy.transactions[index] = { ...copy.transactions[index], [field]: value };
      }
      return copy;
    });
  };

  const addTransactionRow = () => {
    setEditData((prev: any) => {
      const copy = { ...prev };
      const newRow = { date: new Date().toISOString().split('T')[0], description: "", amount: 0, category: "其他" };
      if (copy.accounts) {
        copy.accounts = [...copy.accounts];
        const accCopy = { ...copy.accounts[activeAccountTab] };
        accCopy.transactions = [...(accCopy.transactions || []), newRow];
        copy.accounts[activeAccountTab] = accCopy;
      } else {
        copy.transactions = [...(copy.transactions || []), newRow];
      }
      return copy;
    });
  };

  const removeTransactionRow = (index: number) => {
    setEditData((prev: any) => {
      const copy = { ...prev };
      if (copy.accounts) {
        copy.accounts = [...copy.accounts];
        const accCopy = { ...copy.accounts[activeAccountTab] };
        accCopy.transactions = accCopy.transactions.filter((_: any, i: number) => i !== index);
        copy.accounts[activeAccountTab] = accCopy;
      } else {
        copy.transactions = copy.transactions.filter((_: any, i: number) => i !== index);
      }
      return copy;
    });
  };

  const activeAcc = editData ? (editData.accounts ? editData.accounts[activeAccountTab] : null) : null;

  return (
    <div className="max-w-[1600px] mx-auto min-h-screen bg-[#f8fafc] text-slate-800 p-6 flex gap-6 animate-in fade-in duration-500">
      
      {/* LEFT COLUMN: Upload Panel */}
      <div className="w-[420px] shrink-0 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col h-[calc(100vh-100px)] sticky top-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-bold shadow-md">上傳</div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">上傳對帳單</h1>
            <p className="text-xs text-slate-500 mt-1">請上傳單份 PDF 對帳單，先解析並核對無誤後再匯入</p>
          </div>
        </div>

        <div className="flex justify-between text-sm font-bold text-slate-700 mb-4 px-1">
          <span>請選擇檔案上傳</span>
          <span className="text-slate-400 font-normal text-xs flex items-center gap-1">
            安全加密不外洩
          </span>
        </div>

        <div className="space-y-4 flex-1 overflow-y-auto pr-2 pb-4">
          {KINDS.map((k) => (
            <div key={k.id} className="relative border border-slate-200 rounded-xl p-4 flex gap-4 bg-white transition-all hover:border-blue-400 hover:shadow-sm">
              <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white font-bold text-sm shadow-md">
                {k.num}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-slate-800">{k.title}</h3>
                </div>
                <p className="text-xs text-slate-500 mb-3">{k.sub}</p>
                <div className="inline-block px-2 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded">
                  {k.ext}
                </div>
              </div>
              <div 
                className={`w-[140px] border border-dashed rounded-lg flex flex-col items-center justify-center text-xs p-2 transition-colors cursor-pointer ${files[k.id].length > 0 ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:bg-slate-50'}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleFileDrop(e, k.id)}
                onClick={() => document.getElementById(`file-${k.id}`)?.click()}
              >
                <span className="text-slate-600 text-center font-medium leading-tight">
                  {files[k.id].length > 0 ? <span className="text-blue-700 font-bold">已選 {files[k.id].length} 檔</span> : '拖曳檔案或'}
                </span>
                {files[k.id].length === 0 && <button className="mt-1 bg-blue-600 text-white px-3 py-1 rounded text-[10px] shadow-sm">瀏覽</button>}
                <input type="file" id={`file-${k.id}`} className="hidden" accept=".pdf" onChange={(e) => handleFileSelect(e, k.id)} />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col gap-4">
          <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div className="flex-1">
              <div className="text-xs font-bold text-slate-700 mb-1">PDF 密碼解鎖 (若無免填)</div>
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="請輸入解鎖密碼" 
                className="w-full bg-white border border-slate-300 rounded px-3 py-1.5 text-sm outline-none focus:border-blue-500 transition-colors"
              />
            </div>
          </div>

          <button 
            onClick={handleParse}
            disabled={uploadedCount === 0 || isProcessing}
            className={`w-full py-4 rounded-xl font-bold text-lg text-white shadow-lg transition-all flex items-center justify-center gap-2 ${uploadedCount > 0 && !isProcessing ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:scale-[1.02] hover:shadow-xl' : 'bg-slate-300 cursor-not-allowed'}`}
          >
            {isProcessing ? '處理中請稍候...' : '開始 AI 解析檔案'}
          </button>
        </div>
        {statusMsg && (
          <div className={`mt-3 text-center text-sm font-bold ${success ? 'text-green-600' : 'text-blue-600'}`}>
            {statusMsg}
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: Review & Confirm Dashboard */}
      <div className="flex-1 flex flex-col h-[calc(100vh-100px)] overflow-y-auto">
        {!editData ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-full flex flex-col items-center justify-center text-slate-400">
            <div className="font-bold text-lg text-slate-500">尚無解析資料</div>
            <div className="text-sm mt-2 text-center">請上傳對帳單並點擊「開始 AI 解析檔案」，即可在此核對並儲存結果。</div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
            
            {/* Header */}
            <div className="flex justify-between items-center border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <span>步驟二：核對並確認解析資料</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">請仔細核對以下欄位是否正確，確認無誤後即可點擊最下方的「確認並寫入資料庫」</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={handleCancelReview}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={handleConfirm}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 shadow-sm transition-colors"
                >
                  確認無誤並寫入資料庫
                </button>
              </div>
            </div>

            {/* Tab selector for multiple bank accounts */}
            {editData.accounts && editData.accounts.length > 1 && (
              <div className="flex gap-2 pb-2 overflow-x-auto border-b border-slate-100">
                {editData.accounts.map((acc: any, idx: number) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveAccountTab(idx)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
                      activeAccountTab === idx
                        ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-500/25"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-slate-300"
                    }`}
                  >
                    帳戶 {idx + 1}: {acc.currency} {acc.account_number ? `(${acc.account_number})` : ""}
                  </button>
                ))}
              </div>
            )}

            {/* Basic Config Card */}
            <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 space-y-4">
              <h3 className="font-bold text-slate-800 text-sm">基本資訊</h3>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">記帳期間 (年)</label>
                  <input 
                    type="number"
                    value={editData.period_year}
                    onChange={e => updateField("period_year", parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">記帳期間 (月)</label>
                  <input 
                    type="number"
                    value={editData.period_month}
                    onChange={e => updateField("period_month", parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">金融機構名稱</label>
                  <input 
                    type="text"
                    value={editData.institution}
                    onChange={e => updateField("institution", e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">幣別</label>
                  <input 
                    type="text"
                    value={activeAcc ? activeAcc.currency : editData.currency}
                    onChange={e => {
                      if (activeAcc) {
                        updateAccountField(activeAccountTab, "currency", e.target.value);
                      } else {
                        updateField("currency", e.target.value);
                      }
                    }}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                {((activeAcc ? activeAcc.currency : editData.currency) !== "TWD") && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">
                      {(activeAcc ? activeAcc.currency : editData.currency)}/TWD 匯率
                    </label>
                    <input 
                      type="number"
                      step="0.0001"
                      value={activeAcc ? activeAcc.exchange_rate : editData.exchange_rate}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 1.0;
                        if (activeAcc) {
                          updateAccountField(activeAccountTab, "exchange_rate", val);
                        } else {
                          updateField("exchange_rate", val);
                        }
                      }}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-semibold focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}
                {(editData.kind === "bank" || editData.kind === "brokerage") && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">帳戶號碼 / 帳號 (可留空/修改)</label>
                    <input 
                      type="text"
                      value={activeAcc ? activeAcc.account_number : (editData.account_number || "")}
                      onChange={e => {
                        if (activeAcc) {
                          updateAccountField(activeAccountTab, "account_number", e.target.value);
                        } else {
                          updateField("account_number", e.target.value);
                        }
                      }}
                      placeholder="留空使用預設帳戶"
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}
                {editData.kind === "bank" && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">
                      結餘金額 ({activeAcc ? activeAcc.currency : "TWD"})
                    </label>
                    <input 
                      type="number"
                      value={activeAcc ? activeAcc.closing_balance : editData.closing_balance}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0;
                        if (activeAcc) {
                          updateAccountField(activeAccountTab, "closing_balance", val);
                        } else {
                          updateField("closing_balance", val);
                        }
                      }}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-semibold focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}
                {editData.kind === "credit_card" && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">當期帳單總金額</label>
                      <input 
                        type="number"
                        value={editData.total_amount}
                        onChange={e => updateField("total_amount", parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-semibold focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">繳款截止日 (YYYY-MM-DD)</label>
                      <input 
                        type="text"
                        placeholder="2026-05-25"
                        value={editData.payment_due_date}
                        onChange={e => updateField("payment_due_date", e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">卡號末四碼</label>
                      <input 
                        type="text"
                        value={editData.card_last_four}
                        onChange={e => updateField("card_last_four", e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </>
                )}
                {editData.kind === "brokerage" && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">現金餘額 (原始幣別)</label>
                      <input 
                        type="number"
                        value={editData.cash_balance}
                        onChange={e => updateField("cash_balance", parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-semibold focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">證券總市值 (原始幣別)</label>
                      <input 
                        type="number"
                        value={editData.total_market_value}
                        onChange={e => updateField("total_market_value", parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-semibold focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Holdings Card (For Brokerage only) */}
            {editData.kind === "brokerage" && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-slate-800 text-sm">證券持股部位 (Holdings)</h3>
                  <button 
                    onClick={addHoldingRow}
                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors border border-slate-300"
                  >
                    新增持股列
                  </button>
                </div>
                
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 w-20">標的代號</th>
                        <th className="px-3 py-2 w-48">標的名稱</th>
                        <th className="px-3 py-2 text-right">持有數量</th>
                        <th className="px-3 py-2 text-right">平均成本</th>
                        <th className="px-3 py-2 text-right">收盤現價</th>
                        <th className="px-3 py-2 text-center w-12">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {editData.holdings?.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-6 text-slate-400">尚無持有部位，可手動新增。</td>
                        </tr>
                      ) : (
                        editData.holdings.map((h: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="px-3 py-1.5">
                              <input 
                                type="text"
                                value={h.ticker}
                                onChange={e => updateHolding(idx, "ticker", e.target.value)}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input 
                                type="text"
                                value={h.name}
                                onChange={e => updateHolding(idx, "name", e.target.value)}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input 
                                type="number"
                                value={h.quantity}
                                onChange={e => updateHolding(idx, "quantity", parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-right focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input 
                                type="number"
                                value={h.avg_cost}
                                onChange={e => updateHolding(idx, "avg_cost", parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-right focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input 
                                type="number"
                                value={h.current_price}
                                onChange={e => updateHolding(idx, "current_price", parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-right focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <button 
                                onClick={() => removeHoldingRow(idx)}
                                className="text-red-500 hover:bg-red-50 px-2 py-0.5 rounded text-xs transition-colors"
                              >
                                刪除
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Transactions Card */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-slate-800 text-sm">交易明細 (Transactions)</h3>
                <button 
                  onClick={addTransactionRow}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors border border-slate-300"
                >
                  新增交易列
                </button>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                {editData.kind === "brokerage" ? (
                  /* Brokerage specific transaction table */
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 w-28">交易日期</th>
                        <th className="px-3 py-2 w-20">標的</th>
                        <th className="px-3 py-2 w-28">動作</th>
                        <th className="px-3 py-2 w-24 text-right">交易股數</th>
                        <th className="px-3 py-2 w-24 text-right">成交單價</th>
                        <th className="px-3 py-2 w-20 text-right">手續費</th>
                        <th className="px-3 py-2 w-32 text-right">收付金額</th>
                        <th className="px-3 py-2">交易說明</th>
                        <th className="px-3 py-2 text-center w-12">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {editData.transactions?.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="text-center py-8 text-slate-400">尚無交易明細，可點擊右上角手動新增。</td>
                        </tr>
                      ) : (
                        editData.transactions.map((t: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="px-3 py-1.5">
                              <input 
                                type="text"
                                placeholder="YYYY-MM-DD"
                                value={t.date}
                                onChange={e => updateTransactionRow(idx, "date", e.target.value)}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input 
                                type="text"
                                value={t.ticker}
                                onChange={e => updateTransactionRow(idx, "ticker", e.target.value)}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <select
                                value={t.action || ""}
                                onChange={e => {
                                  const act = e.target.value;
                                  updateTransactionRow(idx, "action", act);
                                  // Auto-align category
                                  if (act === "BUY" || act === "SELL") {
                                    updateTransactionRow(idx, "category", "投資");
                                  } else if (act === "DIVIDEND") {
                                    updateTransactionRow(idx, "category", "股利");
                                  } else if (act === "INTEREST") {
                                    updateTransactionRow(idx, "category", "利息");
                                  } else if (act === "TAX") {
                                    updateTransactionRow(idx, "category", "支出");
                                  }
                                }}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs focus:outline-none focus:border-blue-500 focus:bg-white"
                              >
                                <option value="">無/其他</option>
                                <option value="BUY">買進 (BUY)</option>
                                <option value="SELL">賣出 (SELL)</option>
                                <option value="DIVIDEND">配息 (DIVIDEND)</option>
                                <option value="INTEREST">利息 (INTEREST)</option>
                                <option value="TAX">稅金/支出 (TAX)</option>
                              </select>
                            </td>
                            <td className="px-3 py-1.5">
                              <input 
                                type="number"
                                value={t.quantity}
                                onChange={e => {
                                  const qty = parseFloat(e.target.value) || 0;
                                  updateTransactionRow(idx, "quantity", qty);
                                  // Recalculate amount if logic allows
                                  const price = t.price || 0;
                                  const fee = t.fee || 0;
                                  const factor = t.action === "BUY" ? -1 : 1;
                                  updateTransactionRow(idx, "amount", factor * (qty * price) - fee);
                                }}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-right focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input 
                                type="number"
                                value={t.price}
                                onChange={e => {
                                  const prc = parseFloat(e.target.value) || 0;
                                  updateTransactionRow(idx, "price", prc);
                                  const qty = t.quantity || 0;
                                  const fee = t.fee || 0;
                                  const factor = t.action === "BUY" ? -1 : 1;
                                  updateTransactionRow(idx, "amount", factor * (qty * prc) - fee);
                                }}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-right focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input 
                                type="number"
                                value={t.fee}
                                onChange={e => {
                                  const fee = parseFloat(e.target.value) || 0;
                                  updateTransactionRow(idx, "fee", fee);
                                  const qty = t.quantity || 0;
                                  const prc = t.price || 0;
                                  const factor = t.action === "BUY" ? -1 : 1;
                                  updateTransactionRow(idx, "amount", factor * (qty * prc) - fee);
                                }}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-right focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input 
                                type="number"
                                value={t.amount}
                                onChange={e => updateTransactionRow(idx, "amount", parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-right font-semibold focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input 
                                type="text"
                                value={t.description || ""}
                                onChange={e => {
                                  updateTransactionRow(idx, "description", e.target.value);
                                  updateTransactionRow(idx, "merchant", e.target.value);
                                }}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <button 
                                onClick={() => removeTransactionRow(idx)}
                                className="text-red-500 hover:bg-red-50 px-2 py-0.5 rounded text-xs transition-colors"
                              >
                                刪除
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 w-28">交易日期</th>
                        <th className="px-3 py-2 w-32">交易類別</th>
                        <th className="px-3 py-2">交易摘要 / 商家</th>
                        <th className="px-3 py-2 text-right w-36">金額 (原始幣別)</th>
                        <th className="px-3 py-2 text-center w-12">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {((activeAcc ? activeAcc.transactions : editData.transactions) || []).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="text-center py-8 text-slate-400">尚無交易明細，可點擊右上角手動新增。</td>
                        </tr>
                      ) : (
                        (activeAcc ? activeAcc.transactions : editData.transactions).map((t: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="px-3 py-1.5">
                              <input 
                                type="text"
                                placeholder="YYYY-MM-DD"
                                value={t.date}
                                onChange={e => updateTransactionRow(idx, "date", e.target.value)}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <select
                                value={t.category || "其他"}
                                onChange={e => updateTransactionRow(idx, "category", e.target.value)}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs focus:outline-none focus:border-blue-500 focus:bg-white"
                              >
                                <option value="薪資">薪資</option>
                                <option value="投資">投資</option>
                                <option value="支出">支出</option>
                                <option value="轉入">轉入</option>
                                <option value="轉出">轉出</option>
                                <option value="股利">股利</option>
                                <option value="利息">利息</option>
                                <option value="其他">其他</option>
                              </select>
                            </td>
                            <td className="px-3 py-1.5">
                              <input 
                                type="text"
                                value={t.description || t.merchant || ""}
                                onChange={e => {
                                  updateTransactionRow(idx, "description", e.target.value);
                                  updateTransactionRow(idx, "merchant", e.target.value);
                                }}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input 
                                type="number"
                                value={t.amount}
                                onChange={e => updateTransactionRow(idx, "amount", parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-right font-semibold focus:outline-none focus:border-blue-500 focus:bg-white"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <button 
                                onClick={() => removeTransactionRow(idx)}
                                className="text-red-500 hover:bg-red-50 px-2 py-0.5 rounded text-xs transition-colors"
                              >
                                刪除
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button 
                onClick={handleCancelReview}
                className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-colors"
              >
                取消核對
              </button>
              <button 
                onClick={handleConfirm}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 shadow-md hover:shadow-lg hover:scale-[1.01] transition-all"
              >
                確認無誤並寫入資料庫
              </button>
            </div>

          </div>
        )}
      </div>

    </div>
  );
}
