import { useEffect, useState } from "react";
import { getAccounts, createAccount, updateAccount, deleteAccount, Account } from "../services/api";
import { toast } from "../store/useToastStore";

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Modals / Forms
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  // Form states
  const [formName, setFormName] = useState("");
  const [formInstitution, setFormInstitution] = useState("");
  const [formType, setFormType] = useState("bank");
  const [formCurrency, setFormCurrency] = useState("TWD");
  const [formCode, setFormCode] = useState("");
  const [formIsInternal, setFormIsInternal] = useState(true);

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      const data = await getAccounts();
      setAccounts(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleOpenAdd = () => {
    setFormName("");
    setFormInstitution("");
    setFormType("bank");
    setFormCurrency("TWD");
    setFormCode("");
    setFormIsInternal(true);
    setShowAddModal(true);
  };

  const handleOpenEdit = (a: Account) => {
    setSelectedAccount(a);
    setFormName(a.name);
    setFormInstitution(a.institution);
    setFormType(a.type);
    setFormCurrency(a.currency);
    setFormCode(a.code || "");
    setFormIsInternal(a.is_internal);
    setShowEditModal(true);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName || !formInstitution) {
      toast.warning("請填寫帳戶名稱與金融機構");
      return;
    }
    try {
      await createAccount(
        formName,
        formType,
        formInstitution,
        formCurrency,
        formCode || undefined
      );
      // If manually created, we might need to set is_internal if it differed from default.
      // But let's check: createAccount in api.ts doesn't take is_internal directly.
      // So we can update it immediately if needed.
      const list = await getAccounts();
      const created = list.find(x => x.name === formName && x.institution === formInstitution);
      if (created && created.is_internal !== formIsInternal) {
        await updateAccount(created.id, { is_internal: formIsInternal });
      }
      toast.success("帳戶建立成功！");
      setShowAddModal(false);
      fetchAccounts();
    } catch (e) {
      console.error(e);
      toast.error("建立帳戶失敗");
    }
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    try {
      await updateAccount(selectedAccount.id, {
        name: formName,
        institution: formInstitution,
        account_type: formType,
        currency: formCurrency,
        is_internal: formIsInternal,
        code: formCode
      });
      toast.success("帳戶修改已儲存！");
      setShowEditModal(false);
      fetchAccounts();
    } catch (e) {
      console.error(e);
      toast.error("儲存帳戶修改失敗");
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("確定要刪除此帳戶嗎？這個操作是安全刪除（隱藏帳戶），但歷史交易數據會保留。")) {
      return;
    }
    try {
      await deleteAccount(id);
      toast.success("帳戶已成功刪除！");
      fetchAccounts();
    } catch (e) {
      console.error(e);
      toast.error("刪除帳戶失敗");
    }
  };

  const getAccountTypeLabel = (type: string) => {
    switch (type) {
      case "bank": return "銀行帳戶";
      case "brokerage": return "證券帳戶";
      case "credit_card": return "信用卡";
      case "liability": return "負債/其他";
      default: return type;
    }
  };

  return (
    <div className="animate-in fade-in duration-500">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">帳戶管理</h1>
          <p className="text-sm text-slate-500 mt-1">管理您所有的銀行帳戶，配置內部帳戶過濾</p>
        </div>
        <button 
          onClick={handleOpenAdd}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl shadow-sm transition-colors text-sm"
        >
          + 新增帳戶
        </button>
      </div>

      {/* Account List */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center text-slate-500 font-bold">載入中...</div>
        ) : accounts.filter(a => a.type === 'bank').length === 0 ? (
          <div className="py-20 text-center text-slate-400">
            <div className="font-bold text-lg mb-2">目前尚無帳戶</div>
            <div className="text-sm">請點擊右上角「新增帳戶」或設定 API 自動同步</div>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">金融機構</th>
                <th className="px-6 py-4">帳戶名稱</th>
                <th className="px-6 py-4">帳號</th>
                <th className="px-6 py-4">帳戶類型</th>
                <th className="px-6 py-4">幣別</th>
                <th className="px-6 py-4">帳內互轉過濾</th>
                <th className="px-6 py-4 text-center w-32">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.filter(a => a.type === 'bank').map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-slate-700">{a.institution}</td>
                  <td className="px-6 py-4 font-medium text-slate-800">{a.name}</td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">{a.code}</td>
                  <td className="px-6 py-4 text-slate-500">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                      a.type === 'bank' ? 'bg-green-50 text-green-700' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {getAccountTypeLabel(a.type)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-600 font-bold">{a.currency}</td>
                  <td className="px-6 py-4">
                    {a.is_internal ? (
                      <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full text-xs font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        啟用 (內部帳戶)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full text-xs font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                        停用 (外部來源)
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex justify-center gap-2">
                      <button 
                        onClick={() => handleOpenEdit(a)}
                        className="text-blue-600 hover:text-blue-700 font-bold text-xs"
                      >
                        編輯
                      </button>
                      <span className="text-slate-300">|</span>
                      <button 
                        onClick={() => handleDelete(a.id)}
                        className="text-red-600 hover:text-red-700 font-bold text-xs"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-[450px] shadow-xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <h3 className="font-bold text-lg text-slate-800 mb-4">新增帳戶</h3>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">金融機構 (如：台新銀行、玉山銀行)</label>
                <input 
                  type="text" 
                  value={formInstitution}
                  onChange={e => setFormInstitution(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  placeholder="請輸入金融機構名稱"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">帳戶名稱 / 自訂標籤</label>
                <input 
                  type="text" 
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  placeholder="如：台新活期存款、玉山台幣帳戶"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">帳戶類型</label>
                  <select 
                    value={formType}
                    onChange={e => setFormType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="bank">銀行帳戶</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">幣別</label>
                  <select 
                    value={formCurrency}
                    onChange={e => setFormCurrency(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="TWD">台幣 (TWD)</option>
                    <option value="USD">美金 (USD)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">帳戶代碼 / 帳號 (選填)</label>
                <input 
                  type="text" 
                  value={formCode}
                  onChange={e => setFormCode(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  placeholder="如：bank_taishin_12345"
                />
              </div>
              <div className="flex items-center gap-3 py-2">
                <input 
                  type="checkbox" 
                  id="add_is_internal"
                  checked={formIsInternal}
                  onChange={e => setFormIsInternal(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="add_is_internal" className="text-sm font-bold text-slate-700 cursor-pointer select-none">
                  設為「內部帳戶」
                  <span className="block text-xs font-normal text-slate-400 mt-0.5">勾選後，此帳戶與其他內部帳戶之間的互轉交易將自動被損益表排除</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-sm transition-colors"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm transition-colors"
                >
                  確認新增
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-[450px] shadow-xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <h3 className="font-bold text-lg text-slate-800 mb-4">修改帳戶設定</h3>
            <form onSubmit={handleEditSave} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">金融機構</label>
                <input 
                  type="text" 
                  value={formInstitution}
                  onChange={e => setFormInstitution(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">帳戶名稱</label>
                <input 
                  type="text" 
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">帳戶類型</label>
                  <select 
                    value={formType}
                    onChange={e => setFormType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="bank">銀行帳戶</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">幣別</label>
                  <select 
                    value={formCurrency}
                    onChange={e => setFormCurrency(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="TWD">台幣 (TWD)</option>
                    <option value="USD">美金 (USD)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">帳戶代碼 / 帳號</label>
                <input 
                  type="text" 
                  value={formCode}
                  onChange={e => setFormCode(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center gap-3 py-2">
                <input 
                  type="checkbox" 
                  id="edit_is_internal"
                  checked={formIsInternal}
                  onChange={e => setFormIsInternal(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="edit_is_internal" className="text-sm font-bold text-slate-700 cursor-pointer select-none">
                  設為「內部帳戶」
                  <span className="block text-xs font-normal text-slate-400 mt-0.5">勾選後，此帳戶與其他內部帳戶之間的互轉交易將自動被損益表排除</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-sm transition-colors"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm transition-colors"
                >
                  儲存修改
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
