import { useEffect, useState } from "react";
import { getUploadHistory, deleteUploadHistory, UploadHistoryRecord } from "../services/api";
import { toast } from "../store/useToastStore";

export default function UploadHistoryPage() {
  const [history, setHistory] = useState<UploadHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchHistory = async () => {
    try {
      const data = await getUploadHistory();
      setHistory(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleDelete = async (id: number) => {
    if (!window.confirm("確定要刪除這筆上傳紀錄嗎？（注意：這只會刪除紀錄解除重複檔案鎖定，不會刪除已解析出的交易明細喔！）")) {
      return;
    }
    try {
      await deleteUploadHistory(id);
      await fetchHistory(); // reload
    } catch (e) {
      console.error(e);
      toast.error("刪除失敗");
    }
  };

  const getKindLabel = (kind: string) => {
    switch (kind) {
      case "bank": return "銀行對帳單";
      case "credit_card": return "信用卡帳單";
      case "brokerage": return "證券對帳單";
      case "einvoice": return "發票載具";
      default: return kind;
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto p-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4 mb-8">
        <div className="bg-blue-600 text-white w-12 h-12 rounded-xl flex items-center justify-center font-bold shadow-md">
          LOG
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">上傳紀錄 (Upload History)</h1>
          <p className="text-sm text-slate-500 mt-1">追蹤與檢視您所有對帳單的上傳與解析狀態</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
            <tr>
              <th className="px-6 py-4">上傳時間</th>
              <th className="px-6 py-4">檔案名稱</th>
              <th className="px-6 py-4">類型</th>
              <th className="px-6 py-4">狀態</th>
              <th className="px-6 py-4">系統備註</th>
              <th className="px-6 py-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                  <div className="animate-pulse">載入中...</div>
                </td>
              </tr>
            ) : history.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  <div>目前尚無任何上傳紀錄</div>
                </td>
              </tr>
            ) : (
              history.map((record) => (
                <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-slate-600">
                    {new Date(record.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-slate-800 font-medium">
                    {record.filename}
                  </td>
                  <td className="px-6 py-4 text-slate-600">
                    {getKindLabel(record.kind)}
                  </td>
                  <td className="px-6 py-4">
                    {record.status === "success" ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-700 font-bold text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                        解析成功
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-700 font-bold text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                        上傳失敗
                      </span>
                    )}
                  </td>
                  <td className={`px-6 py-4 max-w-[200px] truncate ${record.status === 'error' ? 'text-red-600' : 'text-slate-500'}`}>
                    {record.message || "-"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleDelete(record.id)}
                      className="px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 font-bold text-xs rounded transition-colors"
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
  );
}
