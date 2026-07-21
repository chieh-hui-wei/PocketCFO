import React, { useEffect, useState } from "react";
import {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  Account,
  getSavingsPots,
  createSavingsPot,
  updateSavingsPot,
  deleteSavingsPot,
  SavingsPot
} from "../services/api";
import { toast } from "../store/useToastStore";

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Virtual Savings Pots States
  const [pots, setPots] = useState<SavingsPot[]>([]);
  const [potsLoading, setPotsLoading] = useState(false);
  const [totalCash, setTotalCash] = useState<number>(0);
  const [latestPeriod, setLatestPeriod] = useState<string | null>(null);
  const [missingAccounts, setMissingAccounts] = useState<string[]>([]);

  const [showAddPotModal, setShowAddPotModal] = useState(false);
  const [showEditPotModal, setShowEditPotModal] = useState(false);
  const [selectedPot, setSelectedPot] = useState<SavingsPot | null>(null);

  const [potFormName, setPotFormName] = useState("");
  const [potFormTarget, setPotFormTarget] = useState<number>(0);
  const [potFormAllocated, setPotFormAllocated] = useState<number>(0);

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
  const [formIsInstallment, setFormIsInstallment] = useState(false);
  const [formInstallmentAmount, setFormInstallmentAmount] = useState<number>(0);

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      const data = await getAccounts();
      setAccounts(data);
    } catch (e) {
      console.error("Failed to fetch accounts", e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPots = async () => {
    setPotsLoading(true);
    try {
      const res = await getSavingsPots();
      setPots(res.pots);
      setTotalCash(res.total_cash);
      setLatestPeriod(res.latest_period ?? null);
      setMissingAccounts(res.missing_accounts || []);
    } catch (e) {
      console.error("Failed to fetch savings pots", e);
    } finally {
      setPotsLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
    fetchPots();
  }, []);

  const handleOpenAdd = () => {
    setFormName("");
    setFormInstitution("");
    setFormType("bank");
    setFormCurrency("TWD");
    setFormCode("");
    setFormIsInternal(true);
    setFormIsInstallment(false);
    setFormInstallmentAmount(0);
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
    setFormIsInstallment(a.is_installment || false);
    setFormInstallmentAmount(a.installment_amount || 0);
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
        formCode || undefined,
        formIsInstallment,
        formInstallmentAmount
      );
      const list = await getAccounts();
      const created = list.find(x => x.name === formName && x.institution === formInstitution);
      if (created) {
        await updateAccount(created.id, {
          is_internal: formIsInternal,
          is_installment: formIsInstallment,
          installment_amount: formInstallmentAmount
        });
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
        code: formCode,
        is_installment: formIsInstallment,
        installment_amount: formInstallmentAmount
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

  // Savings Pots Handlers
  const handleOpenAddPot = () => {
    setPotFormName("");
    setPotFormTarget(0);
    setPotFormAllocated(0);
    setShowAddPotModal(true);
  };

  const handleOpenEditPot = (p: SavingsPot) => {
    setSelectedPot(p);
    setPotFormName(p.name);
    setPotFormTarget(p.target_amount);
    setPotFormAllocated(p.allocated_amount);
    setShowEditPotModal(true);
  };

  const handleAddPot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!potFormName.trim()) {
      toast.warning("請填寫儲蓄桶名稱");
      return;
    }
    if (potFormTarget <= 0) {
      toast.warning("目標金額必須大於 0");
      return;
    }
    try {
      await createSavingsPot(potFormName, potFormTarget, potFormAllocated);
      toast.success("儲蓄目標建立成功！");
      setShowAddPotModal(false);
      fetchPots();
    } catch (e) {
      console.error(e);
      toast.error("建立儲蓄目標失敗");
    }
  };

  const handleEditPotSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPot) return;
    if (!potFormName.trim()) {
      toast.warning("請填寫儲蓄桶名稱");
      return;
    }
    if (potFormTarget <= 0) {
      toast.warning("目標金額必須大於 0");
      return;
    }
    try {
      await updateSavingsPot(selectedPot.id, potFormName, potFormTarget, potFormAllocated);
      toast.success("儲蓄目標修改成功！");
      setShowEditPotModal(false);
      fetchPots();
    } catch (e) {
      console.error(e);
      toast.error("修改儲蓄目標失敗");
    }
  };

  const handleDeletePot = async (id: number) => {
    if (!window.confirm("確定要刪除此儲蓄桶嗎？已分配的金額將會釋回自由現金中。")) {
      return;
    }
    try {
      await deleteSavingsPot(id);
      toast.success("儲蓄桶已成功刪除！");
      fetchPots();
    } catch (e) {
      console.error(e);
      toast.error("刪除儲蓄目標失敗");
    }
  };

  const handleAdjustAllocation = async (pot: SavingsPot, delta: number) => {
    const newVal = Math.max(0, pot.allocated_amount + delta);
    try {
      await updateSavingsPot(pot.id, undefined, undefined, newVal);
      fetchPots();
    } catch (e) {
      console.error(e);
      toast.error("調整分配額度失敗");
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
                <th className="px-6 py-4">帳戶名稱</th>
                <th className="px-6 py-4">帳號</th>
                <th className="px-6 py-4">帳戶類型</th>
                <th className="px-6 py-4">幣別</th>
                <th className="px-6 py-4">帳內互轉過濾</th>
                <th className="px-6 py-4 text-center w-32">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(() => {
                const bankAccounts = accounts.filter(a => a.type === 'bank');
                const groups: Record<string, typeof bankAccounts> = {};
                bankAccounts.forEach(a => {
                  const key = a.institution || "其他機構";
                  if (!groups[key]) groups[key] = [];
                  groups[key].push(a);
                });

                return Object.entries(groups).map(([inst, list]) => (
                  <React.Fragment key={inst}>
                    <tr className="bg-slate-50/50">
                      <td colSpan={6} className="px-6 py-2.5 font-bold text-slate-500 text-xs uppercase tracking-wider bg-slate-100/50">
                        🏛️ {inst}
                      </td>
                    </tr>
                    {list.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 font-semibold text-slate-800">{a.name}</td>
                        <td className="px-6 py-4 font-mono text-xs text-slate-500">{a.code}</td>
                        <td className="px-6 py-4 text-slate-500">
                          <span className={`px-2 py-1 rounded-full text-[10px] font-extrabold ${a.type === 'bank' ? 'bg-green-50 text-green-700 border border-green-200' :
                              'bg-slate-100 text-slate-700'
                            }`}>
                            {getAccountTypeLabel(a.type)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-600 font-bold">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${a.currency !== 'TWD' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-slate-100 text-slate-600'
                            }`}>
                            {a.currency}
                          </span>
                        </td>
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
                  </React.Fragment>
                ));
              })()}
            </tbody>
          </table>
        )}
      </div>

      {/* 🎯 Virtual Savings Pots Section */}
      <div className="mt-10">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <span>🎯</span> 虛擬儲蓄分配桶
            </h2>
            <p className="text-xs text-slate-500 mt-1">將您的實體活期存款分配給不同的儲蓄用途，專款專用不受轉帳影響</p>
          </div>
          <button
            type="button"
            onClick={handleOpenAddPot}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl shadow-sm transition-colors text-xs"
          >
            + 新增儲蓄目標
          </button>
        </div>

        {/* Pots Dashboard Stats */}
        {(() => {
          const totalAllocated = pots.reduce((sum, p) => sum + p.allocated_amount, 0);
          const unallocated = totalCash - totalAllocated;
          const isOverbudget = unallocated < 0;

          return (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm animate-in fade-in duration-300">
                <div className="text-xs font-bold text-slate-500 mb-1">🏦 活期現金總水庫</div>
                <div className="text-xl font-extrabold text-slate-800">
                  ${totalCash.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">所有實體銀行活存帳戶餘額加總</div>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm animate-in fade-in duration-300">
                <div className="text-xs font-bold text-slate-500 mb-1">🔒 已分配儲蓄額度</div>
                <div className="text-xl font-extrabold text-blue-600">
                  ${totalAllocated.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">已鎖定在各個虛擬目標的總額</div>
              </div>
              <div className={`bg-white rounded-2xl p-5 border shadow-sm transition-colors animate-in fade-in duration-300 ${isOverbudget ? 'border-red-200 bg-red-50/10' : 'border-slate-200'
                }`}>
                <div className="text-xs font-bold text-slate-500 mb-1">💸 可自由支配現金</div>
                <div className={`text-xl font-extrabold ${isOverbudget ? 'text-red-600' : 'text-emerald-600'}`}>
                  ${unallocated.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                {isOverbudget ? (
                  <div className="text-[10px] text-red-500 font-bold mt-1">⚠️ 警告：已分配額度超出可用實體餘額！</div>
                ) : (
                  <div className="text-[10px] text-slate-400 mt-1">尚未分配給任何目標的可用現金</div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Missing statement warnings */}
        {latestPeriod && missingAccounts.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
            <span className="text-lg">⚠️</span>
            <div className="text-xs text-amber-800 leading-relaxed">
              <span className="font-bold">未全數更新餘額提醒：</span>
              您目前看到的是 {latestPeriod.split('-')[0]} 年 {parseInt(latestPeriod.split('-')[1])} 月的活水總額。但此月份您尚未上傳
              <span className="font-bold text-amber-900 mx-1">{missingAccounts.join("、")}</span>
              的對帳單（暫以 $0 計算），請上傳對帳單以同步更新最新餘額。
            </div>
          </div>
        )}

        {/* Pots list Grid */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          {potsLoading ? (
            <div className="py-10 text-center text-slate-400 text-sm">載入儲蓄桶中...</div>
          ) : pots.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <div className="font-bold text-sm mb-1.5">尚未建立任何儲蓄目標</div>
              <div className="text-xs">點擊「新增儲蓄目標」開始為不同用途分配預算吧！</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {pots.map((pot) => {
                const percent = pot.target_amount > 0 ? (pot.allocated_amount / pot.target_amount) * 100 : 0;
                return (
                  <div key={pot.id} className="border border-slate-100 rounded-2xl p-5 hover:shadow-md hover:border-slate-200 transition-all duration-200 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start mb-3">
                        <h4 className="font-bold text-slate-800 text-sm">{pot.name}</h4>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditPot(pot)}
                            className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                          >
                            編輯
                          </button>
                          <span className="text-slate-200">|</span>
                          <button
                            type="button"
                            onClick={() => handleDeletePot(pot.id)}
                            className="text-red-400 hover:text-red-600 text-xs font-bold"
                          >
                            刪除
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-between items-end mb-2">
                        <span className="text-xs font-bold text-slate-600">
                          ${pot.allocated_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          <span className="text-slate-400 font-normal"> / ${pot.target_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </span>
                        <span className="text-xs font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                          {percent.toFixed(0)}%
                        </span>
                      </div>

                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mb-5">
                        <div
                          className="bg-blue-600 h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, percent)}%` }}
                        />
                      </div>
                    </div>

                    {/* Allocation Quick Adjust Controls */}
                    <div className="flex items-center gap-2 pt-3 border-t border-slate-50">
                      <button
                        type="button"
                        onClick={() => handleAdjustAllocation(pot, -5000)}
                        className="flex-1 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-600 text-[10px] font-bold py-1.5 rounded-lg border border-slate-200/50 transition-colors cursor-pointer"
                      >
                        -5k
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdjustAllocation(pot, -1000)}
                        className="flex-1 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-600 text-[10px] font-bold py-1.5 rounded-lg border border-slate-200/50 transition-colors cursor-pointer"
                      >
                        -1k
                      </button>
                      <span className="text-slate-300 text-xs px-1 select-none">調整</span>
                      <button
                        type="button"
                        onClick={() => handleAdjustAllocation(pot, 1000)}
                        className="flex-1 bg-blue-50/50 hover:bg-blue-50 hover:text-blue-700 text-blue-600 text-[10px] font-bold py-1.5 rounded-lg border border-blue-100/50 transition-colors cursor-pointer"
                      >
                        +1k
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdjustAllocation(pot, 5000)}
                        className="flex-1 bg-blue-50/50 hover:bg-blue-50 hover:text-blue-700 text-blue-600 text-[10px] font-bold py-1.5 rounded-lg border border-blue-100/50 transition-colors cursor-pointer"
                      >
                        +5k
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
                    <option value="liability">分期負債</option>
                    <option value="credit_card">信用卡</option>
                    <option value="brokerage">證券帳戶</option>
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

              {formType === "liability" && (
                <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-100 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="add_is_installment"
                      checked={formIsInstallment}
                      onChange={e => setFormIsInstallment(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="add_is_installment" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                      這是「定期定額分期付款」
                    </label>
                  </div>
                  {formIsInstallment && (
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1.5">每期應繳/扣除金額 (TWD)</label>
                      <input
                        type="number"
                        value={formInstallmentAmount || ""}
                        onChange={e => setFormInstallmentAmount(parseFloat(e.target.value) || 0)}
                        placeholder="例如: 5000"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                      <span className="block text-xxs text-slate-400 mt-1 font-normal">啟用後，系統每月份會自動從您的負債餘額中扣減此金額，直到餘額歸零。</span>
                    </div>
                  )}
                </div>
              )}

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

      {/* Add Savings Pot Modal */}
      {showAddPotModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-[450px] shadow-xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <h3 className="font-bold text-lg text-slate-800 mb-4">新增儲蓄目標</h3>
            <form onSubmit={handleAddPot} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">儲蓄桶名稱 (如：緊急預備金、日本旅遊)</label>
                <input
                  type="text"
                  value={potFormName}
                  onChange={e => setPotFormName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  placeholder="請輸入目標名稱"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">目標總金額 (TWD)</label>
                <input
                  type="number"
                  value={potFormTarget || ""}
                  onChange={e => setPotFormTarget(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  placeholder="請輸入目標金額"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">已分配金額 (選填，可稍後調整)</label>
                <input
                  type="number"
                  value={potFormAllocated || ""}
                  onChange={e => setPotFormAllocated(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  placeholder="請輸入已分配金額"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddPotModal(false)}
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

      {/* Edit Savings Pot Modal */}
      {showEditPotModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-[450px] shadow-xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <h3 className="font-bold text-lg text-slate-800 mb-4">修改儲蓄目標</h3>
            <form onSubmit={handleEditPotSave} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">儲蓄桶名稱</label>
                <input
                  type="text"
                  value={potFormName}
                  onChange={e => setPotFormName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">目標總金額 (TWD)</label>
                <input
                  type="number"
                  value={potFormTarget || ""}
                  onChange={e => setPotFormTarget(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">已分配金額 (TWD)</label>
                <input
                  type="number"
                  value={potFormAllocated || ""}
                  onChange={e => setPotFormAllocated(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEditPotModal(false)}
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
                    <option value="liability">分期負債</option>
                    <option value="credit_card">信用卡</option>
                    <option value="brokerage">證券帳戶</option>
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

              {formType === "liability" && (
                <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-100 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="edit_is_installment"
                      checked={formIsInstallment}
                      onChange={e => setFormIsInstallment(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="edit_is_installment" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                      這是「定期定額分期付款」
                    </label>
                  </div>
                  {formIsInstallment && (
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1.5">每期應繳/扣除金額 (TWD)</label>
                      <input
                        type="number"
                        value={formInstallmentAmount || ""}
                        onChange={e => setFormInstallmentAmount(parseFloat(e.target.value) || 0)}
                        placeholder="例如: 5000"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                      <span className="block text-xxs text-slate-400 mt-1 font-normal">啟用後，系統每月份會自動從您的負債餘額中扣減此金額，直到餘額歸零。</span>
                    </div>
                  )}
                </div>
              )}

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
