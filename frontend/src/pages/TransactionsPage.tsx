import { useEffect, useState } from "react";
import { 
  getTransactions, 
  updateTransaction, 
  deleteTransaction, 
  TransactionRecord 
} from "../services/api";

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
  const [excludeTransfers, setExcludeTransfers] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"all" | "income" | "expense">(() => {
    const params = new URLSearchParams(window.location.search);
    const paramType = params.get("type");
    if (paramType === "income" || paramType === "expense") return paramType;
    return "all";
  });

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

  const handleStartEdit = (t: TransactionRecord) => {
    setEditingTxnId(t.id);
    setEditDate(t.date);
    setEditCategory(t.category);
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
      alert("儲存交易失敗");
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
      alert("刪除交易失敗");
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
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">交易明細</h1>
          <p className="text-sm text-slate-500 mt-1">完整檢視您每個月的所有收支紀錄，並可自由修改或刪除資料</p>
        </div>
        <div className="flex gap-3">
          <div className="flex bg-slate-100 p-1 rounded-xl shadow-sm border border-slate-200">
            <button 
              onClick={() => setTypeFilter("all")}
              className={`rounded px-3 py-1 text-xs font-bold transition-all cursor-pointer ${
                typeFilter === "all" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              全部
            </button>
            <button 
              onClick={() => setTypeFilter("income")}
              className={`rounded px-3 py-1 text-xs font-bold transition-all cursor-pointer ${
                typeFilter === "income" ? "bg-white text-green-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              僅看收入
            </button>
            <button 
              onClick={() => setTypeFilter("expense")}
              className={`rounded px-3 py-1 text-xs font-bold transition-all cursor-pointer ${
                typeFilter === "expense" ? "bg-white text-red-500 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              僅看支出
            </button>
          </div>
          
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-sm cursor-pointer hover:bg-slate-50 select-none">
            <input 
              type="checkbox"
              checked={excludeTransfers}
              onChange={e => setExcludeTransfers(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
            />
            排除帳內互轉
          </label>
          <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm text-sm font-bold text-slate-700">
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handlePrevMonth}>{"<"}</span>
            {formatMonth(currentDate)}
            <span className="text-slate-400 cursor-pointer hover:text-slate-800" onClick={handleNextMonth}>{">"}</span>
          </div>
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            匯出 Excel
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {(() => {
          const filteredTxns = transactions
            .filter(t => !excludeTransfers || t.category !== "帳內互轉")
            .filter(t => {
              if (typeFilter === "income") return t.amount > 0;
              if (typeFilter === "expense") return t.amount < 0;
              return true;
            });
          return isLoading ? (
            <div className="py-20 text-center text-slate-500 font-bold">載入中...</div>
          ) : filteredTxns.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-400">
              <div className="font-bold text-lg text-slate-500 mb-2">本月尚無交易紀錄</div>
              <div className="text-sm mt-2">請上傳對帳單以產生資料</div>
            </div>
          ) : (
            <table className="w-full text-left text-sm relative">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
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
                  return (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
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
                          <option value="薪資">薪資</option>
                          <option value="投資">投資</option>
                          <option value="支出">支出</option>
                          <option value="轉入">轉入</option>
                          <option value="轉出">轉出</option>
                          <option value="股利">股利</option>
                          <option value="利息">利息</option>
                          <option value="其他">其他</option>
                          <option value="帳內互轉">帳內互轉</option>
                        </select>
                      ) : (
                        t.raw_category || t.category || '-'
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
    </div>
  );
}
