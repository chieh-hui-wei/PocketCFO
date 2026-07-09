import { useEffect, useState } from "react";
import {
  getTransactions,
  updateTransaction,
  deleteTransaction,
  TransactionRecord,
  getAccounts,
  createTransaction,
  Account,
  bulkDeleteTransactions,
  bulkUpdateTransactionCategories
} from "../services/api";
import { toast } from "../store/useToastStore";

export default function TransactionsPage() {
  const [currentDate, setCurrentDate] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const paramYear = params.get("year");
    const paramMonth = params.get("month");
    if (paramYear && paramMonth) {
      return new Date(parseInt(paramYear), parseInt(paramMonth) - 1, 1);
    }
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d;
  });
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [excludeTransfers, setExcludeTransfers] = useState(true);
  const [excludeInvestments, setExcludeInvestments] = useState(false);
  const [excludeCardPayments, setExcludeCardPayments] = useState(false);
  const [selectedTxnIds, setSelectedTxnIds] = useState<number[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | "income" | "expense">(() => {
    const params = new URLSearchParams(window.location.search);
    const paramType = params.get("type");
    if (paramType === "income" || paramType === "expense") return paramType;
    return "all";
  });

  useEffect(() => {
    getAccounts(true)
      .then(setAllAccounts)
      .catch(console.error);
  }, []);

  useEffect(() => {
    // Reset selected account ID if it has no transactions in the loaded transactions list
    if (selectedAccountId !== "all") {
      if (selectedAccountId.startsWith("source:")) {
        const sourceVal = selectedAccountId.split(":")[1];
        const hasSourceData = transactions.some(t => t.source === sourceVal);
        if (!hasSourceData) {
          setSelectedAccountId("all");
        }
      } else {
        const accId = parseInt(selectedAccountId);
        const activeIds = new Set(transactions.map(t => t.account_id).filter(Boolean));
        if (!activeIds.has(accId)) {
          setSelectedAccountId("all");
        }
      }
    }
  }, [transactions]);

  useEffect(() => {
    setSelectedTxnIds([]);
  }, [currentDate, selectedAccountId, excludeTransfers, excludeInvestments, excludeCardPayments, typeFilter]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramYear = params.get("year");
    const paramMonth = params.get("month");
    if (paramYear && paramMonth) {
      setCurrentDate(new Date(parseInt(paramYear), parseInt(paramMonth) - 1, 1));
    }
    const paramType = params.get("type");
    if (paramType === "income" || paramType === "expense") {
      setTypeFilter(paramType);
    } else {
      setTypeFilter("all");
    }
  }, [window.location.search]);

  // Editing States
  const [editingTxnId, setEditingTxnId] = useState<number | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAmount, setEditAmount] = useState<number>(0);

  // Manual Transaction Adding States
  const [showAddModal, setShowAddModal] = useState(false);
  const [formDate, setFormDate] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formMerchant, setFormMerchant] = useState("");
  const [formAmount, setFormAmount] = useState<number>(0);
  const [formType, setFormType] = useState<"income" | "expense">("expense");
  const [formCategory, setFormCategory] = useState("支出");
  const [formSource, setFormSource] = useState("bank");
  const [formAccountId, setFormAccountId] = useState<number | "">("");
  const [accounts, setAccounts] = useState<Account[]>([]);

  const handleOpenAdd = async () => {
    const today = new Date();
    let defaultDate = today.toISOString().split("T")[0];

    if (currentDate.getFullYear() !== today.getFullYear() || currentDate.getMonth() !== today.getMonth()) {
      const month = String(currentDate.getMonth() + 1).padStart(2, "0");
      defaultDate = `${currentDate.getFullYear()}-${month}-01`;
    }

    setFormDate(defaultDate);
    setFormDescription("");
    setFormMerchant("");
    setFormAmount(0);
    setFormType("expense");
    setFormCategory("支出");
    setFormSource("bank");
    setFormAccountId("");
    setShowAddModal(true);

    try {
      const accList = await getAccounts(true);
      setAccounts(accList);
    } catch (e) {
      console.error("Failed to fetch accounts", e);
    }
  };

  const handleCategoryChange = (cat: string) => {
    setFormCategory(cat);
    if (["薪資", "轉入", "股利", "利息", "其他收入"].includes(cat)) {
      setFormType("income");
    } else if (["支出", "轉出", "食物", "交通", "醫療", "娛樂", "保險", "運動", "購物", "其他支出"].includes(cat)) {
      setFormType("expense");
    }
  };

  const handleTypeChange = (type: "income" | "expense") => {
    setFormType(type);
    if (type === "income" && ["支出", "轉出", "食物", "交通", "醫療", "娛樂", "保險", "運動", "購物", "其他支出"].includes(formCategory)) {
      setFormCategory("其他收入");
    } else if (type === "expense" && ["薪資", "轉入", "股利", "利息", "其他收入"].includes(formCategory)) {
      setFormCategory("其他支出");
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDate || !formDescription || formAmount <= 0) {
      toast.warning("請填寫交易日期、說明，且金額必須大於 0");
      return;
    }

    const amountVal = formType === "expense" ? -Math.abs(formAmount) : Math.abs(formAmount);

    try {
      await createTransaction({
        date: formDate,
        description: formDescription,
        merchant: formMerchant || undefined,
        amount: amountVal,
        category: formCategory,
        source: formSource,
        account_id: formAccountId === "" ? null : formAccountId,
      });

      setShowAddModal(false);
      fetchTxns();
    } catch (e) {
      console.error(e);
      toast.error("手動新增交易失敗");
    }
  };

  const fetchTxns = async () => {
    setIsLoading(true);
    try {
      const txns = await getTransactions(currentDate.getFullYear(), currentDate.getMonth() + 1);
      setTransactions(txns);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTxns();
  }, [currentDate]);

  const handlePrevMonth = () => setCurrentDate(d => { const nd = new Date(d); nd.setMonth(d.getMonth() - 1); return nd; });
  const handleNextMonth = () => setCurrentDate(d => { const nd = new Date(d); nd.setMonth(d.getMonth() + 1); return nd; });
  const formatMonth = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月`;

  const getSourceLabel = (src: string) => {
    switch (src) {
      case "bank": return "銀行";
      case "credit_card": return "信用卡";
      case "brokerage": return "證券";
      case "einvoice": return "發票";
      default: return src;
    }
  };

  const getCategoryLabel = (t: TransactionRecord) => {
    if (t.category === "其他") {
      return t.amount > 0 ? "其他收入" : "其他支出";
    }
    return t.category;
  };

  const handleStartEdit = (t: TransactionRecord) => {
    setEditingTxnId(t.id);
    setEditDate(t.date);
    let cat = t.category;
    if (cat === "其他") {
      cat = t.amount > 0 ? "其他收入" : "其他支出";
    }
    setEditCategory(cat);
    setEditDescription(t.description || t.merchant || "");
    setEditAmount(t.amount);
  };

  const handleCancelEdit = () => {
    setEditingTxnId(null);
  };

  const handleSaveEdit = async (id: number) => {
    try {
      await updateTransaction(id, {
        date: editDate,
        description: editDescription,
        merchant: editDescription,
        amount: editAmount,
        category: editCategory
      });
      setEditingTxnId(null);
      fetchTxns();
    } catch (e) {
      console.error(e);
      toast.error("儲存交易失敗");
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("確定要刪除此筆交易嗎？（資產負債表與損益表將會重新計算）")) {
      return;
    }
    try {
      await deleteTransaction(id);
      fetchTxns();
    } catch (e) {
      console.error(e);
      toast.error("刪除交易失敗");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedTxnIds.length === 0) return;
    if (!window.confirm(`確定要刪除這 ${selectedTxnIds.length} 筆交易明細嗎？（所有相關月度報表皆會重新計算）`)) return;

    setIsBulkUpdating(true);
    toast.info("正在批次刪除交易並重新計算報表，請稍候...", 6000);
    try {
      await bulkDeleteTransactions(selectedTxnIds);
      toast.success("批次刪除交易明細成功！");
      setSelectedTxnIds([]);
      fetchTxns();
    } catch (e) {
      console.error(e);
      toast.error("批次刪除交易明細失敗");
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleBulkUpdateCategory = async (category: string) => {
    if (selectedTxnIds.length === 0) return;
    setIsBulkUpdating(true);
    toast.info("正在批次更新交易類別並重新計算報表，請稍候...", 6000);
    try {
      await bulkUpdateTransactionCategories(selectedTxnIds, category);
      toast.success("批次更新交易類別成功！");
      setSelectedTxnIds([]);
      fetchTxns();
    } catch (e) {
      console.error(e);
      toast.error("批次更新交易類別失敗");
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleSelectAll = (checked: boolean, filteredTxns: TransactionRecord[]) => {
    if (checked) {
      setSelectedTxnIds(filteredTxns.map(t => t.id));
    } else {
      setSelectedTxnIds([]);
    }
  };

  const handleSelectRow = (checked: boolean, id: number) => {
    if (checked) {
      setSelectedTxnIds(prev => [...prev, id]);
    } else {
      setSelectedTxnIds(prev => prev.filter(x => x !== id));
    }
  };

  const handleExport = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    const baseUrl = import.meta.env.VITE_API_URL || "/api/v1";
    const url = `${baseUrl}/transactions/export?year=${year}&month=${month}`;
    window.open(url, "_blank");
  };

  return (
    <div className="animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">交易明細</h1>
          <p className="text-sm text-slate-500 mt-1">完整檢視您每個月的所有收支紀錄，並可自由修改或刪除資料</p>
        </div>
        <div className="flex gap-3">
          {selectedTxnIds.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1 rounded-xl animate-in fade-in">
              <span className="text-xs font-bold text-slate-500">已選 {selectedTxnIds.length} 筆：</span>
              <select
                disabled={isBulkUpdating}
                onChange={(e) => {
                  if (e.target.value) {
                    handleBulkUpdateCategory(e.target.value);
                    e.target.value = ""; // Reset value so it can be re-triggered
                  }
                }}
                className={`bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 px-2 py-1 outline-none focus:outline-none transition-colors ${
                  isBulkUpdating ? "cursor-not-allowed opacity-60 bg-slate-100" : "cursor-pointer hover:bg-slate-50"
                }`}
              >
                <option value="">{isBulkUpdating ? "更新中..." : "批量修改類別..."}</option>
                {!isBulkUpdating && (
                  <>
                    <optgroup label="支出類別">
                      {["支出", "食物", "交通", "醫療", "娛樂", "保險", "運動", "購物", "其他"].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </optgroup>
                    <optgroup label="收入類別">
                      {["薪資", "股利", "利息", "其他"].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </optgroup>
                    <optgroup label="通用類別">
                      {["投資", "信用卡繳款", "本金償還", "轉入", "轉出", "帳內互轉"].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </optgroup>
                  </>
                )}
              </select>
              <button
                disabled={isBulkUpdating}
                onClick={handleBulkDelete}
                className={`border px-2 py-1 rounded-lg text-xs font-bold transition-all ${
                  isBulkUpdating 
                    ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed" 
                    : "bg-red-50 hover:bg-red-100 border-red-200 text-red-600 cursor-pointer"
                }`}
              >
                {isBulkUpdating ? "⏳ 處理中" : "🗑️ 刪除所選"}
              </button>
            </div>
          )}
          <button
            onClick={handleExport}
            className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            匯出 Excel
          </button>
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 bg-blue-600 px-4 py-2 rounded-xl text-sm font-bold text-white hover:bg-blue-700 transition-colors shadow-sm cursor-pointer"
          >
            + 手動新增
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-wrap justify-between items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          {/* Account Filter */}
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="bg-white border border-slate-200 px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-600 shadow-sm focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="all">所有交易來源</option>
            {transactions.some(t => t.source === "credit_card") && <option value="source:credit_card">所有信用卡帳單</option>}
            {transactions.some(t => t.source === "e_invoice") && <option value="source:e_invoice">所有電子發票</option>}
            {transactions.some(t => t.source === "brokerage") && <option value="source:brokerage">所有證券交易</option>}
            {/* Bank Accounts Group */}
            {allAccounts.some(acc => acc.type === "bank" && transactions.some(t => t.account_id === acc.id)) && (
              <optgroup label="銀行存款帳戶">
                {allAccounts
                  .filter(acc => acc.type === "bank" && transactions.some(t => t.account_id === acc.id))
                  .map(acc => (
                    <option key={acc.id} value={acc.id.toString()}>
                      {acc.name} ({acc.institution})
                    </option>
                  ))
                }
              </optgroup>
            )}

            {/* Credit Card Accounts Group */}
            {allAccounts.some(acc => acc.type === "credit_card" && transactions.some(t => t.account_id === acc.id)) && (
              <optgroup label="信用卡">
                {allAccounts
                  .filter(acc => acc.type === "credit_card" && transactions.some(t => t.account_id === acc.id))
                  .map(acc => (
                    <option key={acc.id} value={acc.id.toString()}>
                      {acc.institution ? `${acc.institution}信用卡` : acc.name}
                    </option>
                  ))
                }
              </optgroup>
            )}
          </select>

          {/* Type Filter Segment */}
          <div className="flex bg-slate-200/60 p-0.5 rounded-xl border border-slate-200/20">
            <button
              onClick={() => setTypeFilter("all")}
              className={`rounded-lg px-3 py-1 text-xs font-bold transition-all cursor-pointer ${typeFilter === "all" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
            >
              全部
            </button>
            <button
              onClick={() => setTypeFilter("income")}
              className={`rounded-lg px-3 py-1 text-xs font-bold transition-all cursor-pointer ${typeFilter === "income" ? "bg-white text-green-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
            >
              僅看收入
            </button>
            <button
              onClick={() => setTypeFilter("expense")}
              className={`rounded-lg px-3 py-1 text-xs font-bold transition-all cursor-pointer ${typeFilter === "expense" ? "bg-white text-red-500 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
            >
              僅看支出
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-700 select-none">
            <input
              type="checkbox"
              checked={excludeTransfers}
              onChange={e => setExcludeTransfers(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
            />
            排除帳內互轉
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-700 select-none">
            <input
              type="checkbox"
              checked={excludeInvestments}
              onChange={e => setExcludeInvestments(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
            />
            排除投資
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-700 select-none">
            <input
              type="checkbox"
              checked={excludeCardPayments}
              onChange={e => setExcludeCardPayments(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
            />
            排除信用卡繳款
          </label>
          <div className="flex items-center gap-4 bg-white px-3.5 py-1.5 rounded-xl border border-slate-200 shadow-sm text-xs font-bold text-slate-700">
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handlePrevMonth}>{"<"}</span>
            {formatMonth(currentDate)}
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handleNextMonth}>{">"}</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {(() => {
          const filteredTxns = transactions
            .filter(t => {
              if (excludeTransfers && (
                t.category === "帳內互轉" || 
                t.category === "轉入" || 
                t.category === "轉出" || 
                t.category === "TRANSFER_IN" || 
                t.category === "TRANSFER_OUT"
              )) return false;
              if (excludeInvestments && (
                t.category === "投資" || 
                t.category === "INVESTMENT"
              )) return false;
              if (excludeCardPayments && (
                t.category === "信用卡繳款" || 
                t.category === "本金償還" || 
                t.category === "CREDIT_CARD_PAYMENT" || 
                t.category === "DEBT_REPAYMENT"
              )) return false;
              return true;
            })
            .filter(t => {
              if (typeFilter === "income") return t.amount > 0;
              if (typeFilter === "expense") return t.amount < 0;
              return true;
            })
            .filter(t => {
              if (selectedAccountId === "all") return true;
              if (selectedAccountId === "source:credit_card") return t.source === "credit_card";
              if (selectedAccountId === "source:e_invoice") return t.source === "e_invoice";
              if (selectedAccountId === "source:brokerage") return t.source === "brokerage";
              if (selectedAccountId === "source:bank") return t.source === "bank";
              return t.account_id === parseInt(selectedAccountId);
            });
          return isLoading ? (
            <div className="py-20 text-center text-slate-500 font-bold">載入中...</div>
          ) : filteredTxns.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-400">
              <div className="font-bold text-lg text-slate-500 mb-2">本月尚無交易紀錄</div>
              <div className="text-sm mt-2">請上傳對帳單或調整篩選條件以產生資料</div>
            </div>
          ) : (
            <table className="w-full text-left text-sm relative">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-4 w-12 text-center">
                    <input
                      type="checkbox"
                      checked={filteredTxns.length > 0 && selectedTxnIds.length === filteredTxns.length}
                      ref={input => {
                        if (input) {
                          input.indeterminate = selectedTxnIds.length > 0 && selectedTxnIds.length < filteredTxns.length;
                        }
                      }}
                      onChange={e => handleSelectAll(e.target.checked, filteredTxns)}
                      className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-4 w-32">日期</th>
                  <th className="px-4 py-4 w-28">來源</th>
                  <th className="px-4 py-4 w-32">類別</th>
                  <th className="px-4 py-4">摘要 / 商家</th>
                  <th className="px-4 py-4 text-right w-32">金額</th>
                  <th className="px-4 py-4 text-center w-32">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTxns.map((t) => {
                  const isEditing = editingTxnId === t.id;
                  const isSelected = selectedTxnIds.includes(t.id);
                  return (
                    <tr key={t.id} className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-blue-50/20' : ''}`}>
                      {/* Checkbox */}
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => handleSelectRow(e.target.checked, t.id)}
                          className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                      {/* Date */}
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editDate}
                            onChange={e => setEditDate(e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-500"
                          />
                        ) : (
                          t.date
                        )}
                      </td>

                      {/* Source */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold">
                          {t.institution || getSourceLabel(t.source)}
                        </span>
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                        {isEditing ? (
                          <select
                            value={editCategory}
                            onChange={e => setEditCategory(e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-500"
                          >
                            {t.amount > 0 ? (
                              <>
                                <optgroup label="收入類別">
                                  {["薪資", "股利", "利息", "其他收入"].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                </optgroup>
                                <optgroup label="通用類別">
                                  {["投資", "信用卡繳款", "本金償還", "轉入", "轉出", "帳內互轉"].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                </optgroup>
                              </>
                            ) : (
                              <>
                                <optgroup label="支出類別">
                                  {["支出", "食物", "交通", "醫療", "娛樂", "保險", "運動", "購物", "其他支出"].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                </optgroup>
                                <optgroup label="通用類別">
                                  {["投資", "信用卡繳款", "本金償還", "轉入", "轉出", "帳內互轉"].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                </optgroup>
                              </>
                            )}
                          </select>
                        ) : (
                          getCategoryLabel(t) || '-'
                        )}
                      </td>

                      {/* Description */}
                      <td className="px-4 py-3 text-slate-800">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editDescription}
                            onChange={e => setEditDescription(e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-500"
                          />
                        ) : (
                          t.description || t.merchant || '-'
                        )}
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editAmount}
                            onChange={e => setEditAmount(parseFloat(e.target.value) || 0)}
                            className="w-24 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-right focus:outline-none focus:border-blue-500"
                          />
                        ) : (
                          <span className={t.amount > 0 ? "text-green-600" : "text-slate-800"}>
                            {t.amount > 0 ? `+ $${t.amount.toLocaleString()}` : `$${t.amount.toLocaleString()}`}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex justify-center gap-1.5">
                            <button
                              onClick={() => handleSaveEdit(t.id)}
                              className="bg-blue-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-blue-700 shadow-sm transition-colors cursor-pointer"
                            >
                              儲存
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="bg-slate-100 border border-slate-200 text-slate-600 px-2 py-1 rounded text-xs font-bold hover:bg-slate-200 transition-colors cursor-pointer"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-center gap-1.5">
                            <button
                              onClick={() => handleStartEdit(t)}
                              className="bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs font-bold transition-colors cursor-pointer"
                              title="編輯交易"
                            >
                              編輯
                            </button>
                            <button
                              onClick={() => handleDelete(t.id)}
                              className="bg-red-50 border border-red-100 text-red-600 hover:bg-red-100 px-2 py-1 rounded text-xs font-bold transition-colors cursor-pointer"
                              title="刪除交易"
                            >
                              刪除
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        })()}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-6 w-[450px] shadow-xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <h3 className="font-bold text-lg text-slate-800 mb-4">手動新增交易</h3>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">交易日期</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">交易類型</label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-lg">
                    <button
                      type="button"
                      onClick={() => handleTypeChange("expense")}
                      className={`py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${formType === "expense" ? "bg-white text-red-500 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        }`}
                    >
                      支出
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTypeChange("income")}
                      className={`py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${formType === "income" ? "bg-white text-green-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        }`}
                    >
                      收入
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">金額</label>
                  <input
                    type="number"
                    value={formAmount || ""}
                    onChange={e => setFormAmount(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
                    placeholder="請輸入金額"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">交易說明 / 摘要</label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
                  placeholder="如：午餐、薪資轉入、轉帳給朋友"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">交易商家 / 對象 (選填)</label>
                <input
                  type="text"
                  value={formMerchant}
                  onChange={e => setFormMerchant(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
                  placeholder="如：7-11、全家、房東"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">收支分類</label>
                  <select
                    value={formCategory}
                    onChange={e => handleCategoryChange(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
                  >
                    {formType === "income" ? (
                      <>
                        <optgroup label="收入類別">
                          {["薪資", "股利", "利息", "其他收入"].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </optgroup>
                        <optgroup label="通用類別">
                          {["投資", "信用卡繳款", "本金償還", "轉入", "轉出", "帳內互轉"].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </optgroup>
                      </>
                    ) : (
                      <>
                        <optgroup label="支出類別">
                          {["支出", "食物", "交通", "醫療", "娛樂", "保險", "運動", "購物", "其他支出"].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </optgroup>
                        <optgroup label="通用類別">
                          {["投資", "信用卡繳款", "本金償還", "轉入", "轉出", "帳內互轉"].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </optgroup>
                      </>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">交易來源</label>
                  <select
                    value={formSource}
                    onChange={e => setFormSource(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="bank">銀行</option>
                    <option value="credit_card">信用卡</option>
                    <option value="brokerage">證券</option>
                    <option value="einvoice">發票</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">關聯帳戶 (選填)</label>
                <select
                  value={formAccountId}
                  onChange={e => setFormAccountId(e.target.value ? parseInt(e.target.value) : "")}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
                >
                  <option value="">無 (不指定)</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.institution} - {acc.name} ({acc.currency})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-sm transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm transition-colors cursor-pointer"
                >
                  確認新增
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
