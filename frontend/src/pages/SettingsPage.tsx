import React, { useEffect, useState } from "react";
import { 
  getSettings, saveSettings, uploadCertificate, CredentialsSettings, inviteFriend, 
  updateProfile, testConnection, getSchedulerStatus, triggerSchedulerSync,
  listCategoryRules, createCategoryRule, updateCategoryRule, deleteCategoryRule, seedDefaultCategoryRules
} from "../services/api";
import { toast } from "../store/useToastStore";

export default function SettingsPage() {
  const [settingsData, setSettingsData] = useState<CredentialsSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"profile" | "general" | "rules" | "taishin" | "sinopac" | "esun" | "invite" | "scheduler">("profile");
  const [userRole, setUserRole] = useState<string>("");

  // Category Rules states
  const [rules, setRules] = useState<any[]>([]);
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  const [newRuleKeyword, setNewRuleKeyword] = useState("");
  const [newRuleCategory, setNewRuleCategory] = useState("food");
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [editingRuleKeyword, setEditingRuleKeyword] = useState("");
  const [editingRuleCategory, setEditingRuleCategory] = useState("");

  // Profile update states
  const [profileEmail, setProfileEmail] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [profileConfirmPassword, setProfileConfirmPassword] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState("");
  const [profileError, setProfileError] = useState("");

  // Scheduler status states
  const [schedulerStatus, setSchedulerStatus] = useState<any>(null);
  const [isLoadingScheduler, setIsLoadingScheduler] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Invite Friend states
  const [inviteEmail, setInviteEmail] = useState("");
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  const [testingBroker, setTestingBroker] = useState<string | null>(null);

  const handleTestConnection = async (broker: "taishin" | "sinopac" | "esun" | "gemini") => {
    setTestingBroker(broker);
    try {
      const res = await testConnection(broker);
      if (res && res.status === "success") {
        toast.success(res.message || "連線測試成功！");
      } else {
        toast.error("連線測試失敗。");
      }
    } catch (e: any) {
      console.error(e);
      const err = e.response?.data?.detail || e.message || "發生未知錯誤。";
      toast.error(`測試失敗：${err}`);
    } finally {
      setTestingBroker(null);
    }
  };


  // Form states
  const [geminiKey, setGeminiKey] = useState("");
  
  const [esunAccount, setEsunAccount] = useState("");
  const [esunPassword, setEsunPassword] = useState("");
  const [esunCertPassword, setEsunCertPassword] = useState("");
  const [esunApiKey, setEsunApiKey] = useState("");
  const [esunApiSecret, setEsunApiSecret] = useState("");

  const [taishinAccount, setTaishinAccount] = useState("");
  const [taishinApiKey, setTaishinApiKey] = useState("");
  const [taishinApiSecret, setTaishinApiSecret] = useState("");
  const [taishinCertPassword, setTaishinCertPassword] = useState("");

  const [sinopacAccount, setSinopacAccount] = useState("");
  const [sinopacApiKey, setSinopacApiKey] = useState("");
  const [sinopacApiSecret, setSinopacApiSecret] = useState("");
  const [sinopacCertPassword, setSinopacCertPassword] = useState("");

  // Files
  const [taishinCertFile, setTaishinCertFile] = useState<File | null>(null);
  const [sinopacCertFile, setSinopacCertFile] = useState<File | null>(null);
  const [esunCertFile, setEsunCertFile] = useState<File | null>(null);

  const [isSaving, setIsSaving] = useState(false);

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const data = await getSettings();
      setSettingsData(data);
      // Initialize form values (leaving passwords empty to indicate they are already set if present)
      setGeminiKey("");
      setEsunAccount(data.esun_account || "");
      setEsunPassword("");
      setEsunCertPassword("");
      setEsunApiKey("");
      setEsunApiSecret("");
      setTaishinAccount(data.taishin_account_id || "");
      setTaishinApiKey("");
      setTaishinApiSecret("");
      setTaishinCertPassword("");
      setSinopacAccount(data.sinopac_account_id || "");
      setSinopacApiKey("");
      setSinopacApiSecret("");
      setSinopacCertPassword("");
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    try {
      const userStr = localStorage.getItem("pocketcfo_user");
      if (userStr) {
        const user = JSON.parse(userStr);
        if (user) {
          if (user.role) {
            setUserRole(user.role);
          }
          if (user.email) {
            setProfileEmail(user.email);
          }
        }
      }
    } catch (e) {
      console.error("Failed to parse user role in SettingsPage", e);
    }
  }, []);

  const fetchSchedulerStatus = async () => {
    setIsLoadingScheduler(true);
    try {
      const data = await getSchedulerStatus();
      setSchedulerStatus(data);
    } catch (e) {
      console.error(e);
      toast.error("無法取得排程同步狀態");
    } finally {
      setIsLoadingScheduler(false);
    }
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const res = await triggerSchedulerSync();
      toast.success(res.message || "手動同步成功！");
      await fetchSchedulerStatus();
    } catch (e: any) {
      console.error(e);
      const err = e.response?.data?.detail || e.message || "發生未知錯誤。";
      toast.error(`手動同步失敗：${err}`);
      await fetchSchedulerStatus();
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (activeTab === "scheduler") {
      fetchSchedulerStatus();
    }
  }, [activeTab]);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError("");
    setProfileSuccess("");

    if (!profileEmail.trim()) {
      setProfileError("電子信箱不能為空");
      return;
    }

    if (profilePassword && profilePassword !== profileConfirmPassword) {
      setProfileError("兩次輸入的密碼不一致");
      return;
    }

    if (profilePassword && profilePassword.length < 6) {
      setProfileError("密碼長度必須大於或等於 6 個字元");
      return;
    }

    setIsSavingProfile(true);
    try {
      // Get current email from settings or storage
      let currentEmail = "";
      const userStr = localStorage.getItem("pocketcfo_user");
      if (userStr) {
        const user = JSON.parse(userStr);
        currentEmail = user.email || "";
      }

      await updateProfile(
        profileEmail.trim() !== currentEmail ? profileEmail.trim() : undefined,
        profilePassword ? profilePassword : undefined
      );
      setProfileSuccess("個人帳戶設定已成功更新！");
      setProfilePassword("");
      setProfileConfirmPassword("");
    } catch (err: any) {
      console.error(err);
      const detail = err.response?.data?.detail || "更新帳戶設定失敗，請確認信箱格式或是否已被使用。";
      setProfileError(detail);
    } finally {
      setIsSavingProfile(false);
    }
  };

  // ── Category Rules Handlers ──────────────────────────────────────────

  const fetchRules = async () => {
    setIsLoadingRules(true);
    try {
      const data = await listCategoryRules();
      setRules(data.rules || []);
    } catch (e) {
      console.error(e);
      toast.error("無法載入分類規則");
    } finally {
      setIsLoadingRules(false);
    }
  };

  useEffect(() => {
    if (activeTab === "rules") {
      fetchRules();
    }
  }, [activeTab]);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleKeyword.trim()) return;
    try {
      await createCategoryRule(newRuleKeyword.trim(), newRuleCategory);
      toast.success("規則新增成功！");
      setNewRuleKeyword("");
      fetchRules();
    } catch (err: any) {
      console.error(err);
      const detail = err.response?.data?.detail || "新增失敗，關鍵字可能已存在。";
      toast.error(detail);
    }
  };

  const handleStartEditRule = (r: any) => {
    setEditingRuleId(r.id);
    setEditingRuleKeyword(r.keyword);
    setEditingRuleCategory(r.category);
  };

  const handleSaveRuleEdit = async (id: number) => {
    if (!editingRuleKeyword.trim()) return;
    try {
      await updateCategoryRule(id, editingRuleKeyword.trim(), editingRuleCategory);
      toast.success("規則更新成功！");
      setEditingRuleId(null);
      fetchRules();
    } catch (err: any) {
      console.error(err);
      toast.error("更新規則失敗");
    }
  };

  const handleDeleteRule = async (id: number) => {
    if (!window.confirm("確定要刪除此規則嗎？")) return;
    try {
      await deleteCategoryRule(id);
      toast.success("規則已刪除");
      fetchRules();
    } catch (err: any) {
      console.error(err);
      toast.error("刪除規則失敗");
    }
  };

  const handleSeedRules = async () => {
    try {
      const res = await seedDefaultCategoryRules();
      toast.success(`成功匯入 ${res.added || 0} 筆預設規則！`);
      fetchRules();
    } catch (e) {
      console.error(e);
      toast.error("匯入預設規則失敗");
    }
  };


  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setIsSendingInvite(true);
    setInviteError("");
    setInviteSuccess("");

    try {
      const res = await inviteFriend(inviteEmail.trim());
      setInviteSuccess(res.message || "邀請碼寄送成功！");
      setInviteEmail("");
    } catch (err: any) {
      console.error(err);
      const detail = err.response?.data?.detail || "邀請失敗，請確認該信箱是否已註冊，且 SMTP 伺服器配置正確。";
      setInviteError(detail);
    } finally {
      setIsSendingInvite(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const payload: any = {};
      if (activeTab === "general" && geminiKey) payload.gemini_api_key = geminiKey;
      
      if (activeTab === "esun") {
        if (esunAccount) payload.esun_account = esunAccount;
        if (esunPassword) payload.esun_password = esunPassword;
        if (esunCertPassword) payload.esun_cert_password = esunCertPassword;
        if (esunApiKey) payload.esun_api_key = esunApiKey;
        if (esunApiSecret) payload.esun_api_secret = esunApiSecret;
      }
      
      if (activeTab === "taishin") {
        if (taishinAccount) payload.taishin_account_id = taishinAccount;
        if (taishinApiKey) payload.taishin_api_key = taishinApiKey;
        if (taishinApiSecret) payload.taishin_api_secret = taishinApiSecret;
        if (taishinCertPassword) payload.taishin_cert_password = taishinCertPassword;
      }
      
      if (activeTab === "sinopac") {
        if (sinopacAccount) payload.sinopac_account_id = sinopacAccount;
        if (sinopacApiKey) payload.sinopac_api_key = sinopacApiKey;
        if (sinopacApiSecret) payload.sinopac_api_secret = sinopacApiSecret;
        if (sinopacCertPassword) payload.sinopac_cert_password = sinopacCertPassword;
      }

      if (Object.keys(payload).length === 0) {
        toast.warning("未輸入任何修改資訊");
        setIsSaving(false);
        return;
      }

      const res = await saveSettings(payload);
      toast.success(res.message || "設定儲存成功！");
      fetchSettings();
    } catch (e) {
      console.error(e);
      toast.error("儲存設定失敗");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadCert = async (broker: "taishin" | "sinopac" | "esun") => {
    let file: File | null = null;
    if (broker === "taishin") file = taishinCertFile;
    if (broker === "sinopac") file = sinopacCertFile;
    if (broker === "esun") file = esunCertFile;

    if (!file) {
      toast.warning("請先選擇憑證檔案");
      return;
    }

    try {
      await uploadCertificate(file, broker);
      toast.success(`${broker === "taishin" ? "台新證券" : broker === "sinopac" ? "永豐金證券" : "玉山證券"} 憑證上傳成功！`);
      if (broker === "taishin") setTaishinCertFile(null);
      if (broker === "sinopac") setSinopacCertFile(null);
      if (broker === "esun") setEsunCertFile(null);
      fetchSettings();
    } catch (e) {
      console.error(e);
      toast.error("上傳憑證失敗");
    }
  };

  if (isLoading && !settingsData) {
    return (
      <div className="animate-in fade-in duration-500 py-20 text-center text-slate-500 font-bold">
        載入設定中...
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500">
      
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">系統與憑證設定</h1>
        <p className="text-sm text-slate-500 mt-1">管理各家券商的 API 密鑰、交易密碼與安全性證書憑證</p>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-4 gap-8">
        
        {/* Navigation Sidebar */}
        <div className="col-span-1 space-y-2">
          {[
            { id: "profile", label: "個人帳戶設定" },
            { id: "general", label: "核心設定 & AI" },
            { id: "taishin", label: "台新證券設定" },
            { id: "sinopac", label: "永豐金證券設定" },
            { id: "esun", label: "玉山證券設定" },
            { id: "scheduler", label: "自動同步排程狀態" },
            ...(userRole === "admin" ? [{ id: "invite", label: "邀請好友" }] : []),
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 ${
                activeTab === tab.id
                  ? "bg-blue-600 text-white shadow-md shadow-blue-500/10"
                  : "bg-white text-slate-600 border border-slate-200/50 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Configurations Panel */}
        <div className="col-span-3">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-8">
            
            {/* Profile Tab */}
            {activeTab === "profile" && (
              <form onSubmit={handleProfileSubmit} className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 mb-1">個人帳戶設定</h3>
                  <p className="text-xs text-slate-500">更新您的電子信箱與登入密碼</p>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5">電子信箱 (帳號)</label>
                    <input
                      type="email"
                      required
                      value={profileEmail}
                      onChange={e => setProfileEmail(e.target.value)}
                      placeholder="請輸入電子信箱..."
                      disabled={isSavingProfile}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5">新登入密碼 (若不修改請留空)</label>
                    <input
                      type="password"
                      value={profilePassword}
                      onChange={e => setProfilePassword(e.target.value)}
                      placeholder="請輸入新密碼 (至少 6 個字元)..."
                      disabled={isSavingProfile}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5">確認新登入密碼</label>
                    <input
                      type="password"
                      value={profileConfirmPassword}
                      onChange={e => setProfileConfirmPassword(e.target.value)}
                      placeholder="請再次輸入新密碼..."
                      disabled={isSavingProfile}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    />
                  </div>
                </div>

                {profileError && (
                  <div className="text-xs font-semibold text-rose-500 flex items-center gap-1.5 animate-in fade-in">
                    <span>⚠️</span>
                    <span>{profileError}</span>
                  </div>
                )}

                {profileSuccess && (
                  <div className="text-xs font-semibold text-emerald-600 flex items-center gap-1.5 animate-in fade-in">
                    <span>✅</span>
                    <span>{profileSuccess}</span>
                  </div>
                )}

                <div className="pt-4 border-t border-slate-100">
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
                  >
                    {isSavingProfile ? "更新中..." : "儲存設定"}
                  </button>
                </div>
              </form>
            )}

            {/* General Tab */}
            {activeTab === "general" && (

              <form onSubmit={handleSave} className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 mb-1">Google Gemini AI</h3>
                  <p className="text-xs text-slate-400">用於對帳單 PDF 解析與數據清洗的語意模型</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">Gemini API Key</label>
                  <input
                    type="password"
                    value={geminiKey}
                    onChange={e => setGeminiKey(e.target.value)}
                    placeholder={settingsData?.gemini_api_key || "未設定"}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">※ 基於安全性考量，已保存的 API Key 會被隱藏。</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">當前 AI 預設模型</label>
                  <input
                    type="text"
                    disabled
                    value={settingsData?.gemini_model || "gemini-3.1-flash-lite"}
                    className="w-full px-3 py-2 border border-slate-100 bg-slate-50 rounded-lg text-sm text-slate-500"
                  />
                </div>
                <div className="pt-4 border-t border-slate-100 flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
                  >
                    儲存變更
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTestConnection("gemini")}
                    disabled={testingBroker === "gemini"}
                    className="border border-blue-600 hover:bg-blue-50 text-blue-600 font-bold px-6 py-2 rounded-xl text-sm transition-all duration-200 disabled:opacity-50"
                  >
                    {testingBroker === "gemini" ? "測試中..." : "測試 API 連線"}
                  </button>
                </div>
              </form>
            )}

            {/* Category Rules Tab */}
            {activeTab === "rules" && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">記帳分類自動規則</h3>
                    <p className="text-xs text-slate-500">設定特定商家或摘要關鍵字自動對應的收支類別</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSeedRules}
                    className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-4 py-2 rounded-xl text-xs transition-colors border border-blue-100"
                  >
                    ✨ 匯入系統預設自動規則
                  </button>
                </div>

                {/* Add New Rule Form */}
                <form onSubmit={handleCreateRule} className="bg-slate-50/80 rounded-2xl p-6 border border-slate-200/50 space-y-4">
                  <h4 className="text-xs font-bold text-slate-700">➕ 新增自動分類規則</h4>
                  <div className="flex flex-col sm:flex-row gap-4 items-end">
                    <div className="flex-1 w-full">
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">關鍵字 (不分大小寫)</label>
                      <input
                        type="text"
                        required
                        value={newRuleKeyword}
                        onChange={e => setNewRuleKeyword(e.target.value)}
                        placeholder="例如：蝦皮、中油、宜得利..."
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="w-full sm:w-[200px]">
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">自動歸類至</label>
                      <select
                        value={newRuleCategory}
                        onChange={e => setNewRuleCategory(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500"
                      >
                        <optgroup label="支出類別">
                          <option value="food">食物</option>
                          <option value="transport">交通</option>
                          <option value="medical">醫療</option>
                          <option value="entertainment">娛樂</option>
                          <option value="insurance">保險</option>
                          <option value="exercise">運動</option>
                          <option value="shopping">購物</option>
                          <option value="other">其他支出 (OTHER)</option>
                        </optgroup>
                        <optgroup label="收入類別">
                          <option value="salary">薪資</option>
                          <option value="dividend">股利</option>
                          <option value="interest">利息</option>
                          <option value="other">其他收入 (OTHER)</option>
                        </optgroup>
                        <optgroup label="通用/轉帳類別">
                          <option value="investment">投資</option>
                          <option value="credit_card_payment">信用卡繳款</option>
                          <option value="debt_repayment">本金償還</option>
                          <option value="transfer_in">轉入</option>
                          <option value="transfer_out">轉出</option>
                        </optgroup>
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-xl text-sm transition-colors shadow-sm w-full sm:w-auto"
                    >
                      新增規則
                    </button>
                  </div>
                </form>

                {/* Rules Table */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-700">📋 目前已設定的規則 ({rules.length} 筆)</h4>
                  
                  {isLoadingRules ? (
                    <div className="text-center py-10 text-slate-500 font-bold text-sm">載入規則中...</div>
                  ) : rules.length === 0 ? (
                    <div className="text-center py-10 text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl">
                      尚未設定任何自訂規則，您可以自行新增或點擊右上角匯入預設規則。
                    </div>
                  ) : (
                    <div className="border border-slate-200/80 rounded-xl overflow-hidden shadow-sm">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500">
                            <th className="px-4 py-3">商家/摘要關鍵字</th>
                            <th className="px-4 py-3">對應分類</th>
                            <th className="px-4 py-3 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rules.map((rule) => {
                            const isEditing = editingRuleId === rule.id;
                            return (
                              <tr key={rule.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                                <td className="px-4 py-3.5 font-medium text-slate-800">
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      value={editingRuleKeyword}
                                      onChange={e => setEditingRuleKeyword(e.target.value)}
                                      className="px-2 py-1 border border-slate-300 rounded text-xs w-full focus:outline-none focus:border-blue-500 bg-white"
                                    />
                                  ) : (
                                    rule.keyword
                                  )}
                                </td>
                                <td className="px-4 py-3.5">
                                  {isEditing ? (
                                    <select
                                      value={editingRuleCategory}
                                      onChange={e => setEditingRuleCategory(e.target.value)}
                                      className="px-2 py-1 border border-slate-300 rounded text-xs w-full focus:outline-none focus:border-blue-500 bg-white"
                                    >
                                      <optgroup label="支出類別">
                                        <option value="food">食物</option>
                                        <option value="transport">交通</option>
                                        <option value="medical">醫療</option>
                                        <option value="entertainment">娛樂</option>
                                        <option value="insurance">保險</option>
                                        <option value="exercise">運動</option>
                                        <option value="shopping">購物</option>
                                        <option value="other">其他支出 (OTHER)</option>
                                      </optgroup>
                                      <optgroup label="收入類別">
                                        <option value="salary">薪資</option>
                                        <option value="dividend">股利</option>
                                        <option value="interest">利息</option>
                                        <option value="other">其他收入 (OTHER)</option>
                                      </optgroup>
                                      <optgroup label="通用/轉帳類別">
                                        <option value="investment">投資</option>
                                        <option value="credit_card_payment">信用卡繳款</option>
                                        <option value="debt_repayment">本金償還</option>
                                        <option value="transfer_in">轉入</option>
                                        <option value="transfer_out">轉出</option>
                                      </optgroup>
                                    </select>
                                  ) : (
                                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                      ["food", "transport", "shopping", "entertainment", "medical", "exercise", "insurance"].includes(rule.category)
                                        ? "bg-rose-50 text-rose-700 border border-rose-100"
                                        : ["salary", "dividend", "interest"].includes(rule.category)
                                          ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                                          : "bg-slate-50 text-slate-600 border border-slate-100"
                                    }`}>
                                      {rule.category_label || rule.category}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                  {isEditing ? (
                                    <div className="flex justify-end gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleSaveRuleEdit(rule.id)}
                                        className="text-emerald-600 hover:text-emerald-800 text-xs font-bold cursor-pointer"
                                      >
                                        儲存
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingRuleId(null)}
                                        className="text-slate-500 hover:text-slate-700 text-xs font-bold cursor-pointer"
                                      >
                                        取消
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex justify-end gap-3">
                                      <button
                                        type="button"
                                        onClick={() => handleStartEditRule(rule)}
                                        className="text-blue-600 hover:text-blue-800 text-xs font-bold cursor-pointer"
                                      >
                                        編輯
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteRule(rule.id)}
                                        className="text-rose-600 hover:text-rose-850 text-xs font-bold cursor-pointer"
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
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Taishin Tab */}
            {activeTab === "taishin" && (
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 mb-1">台新證券 (Taishin Securities)</h3>
                  <p className="text-xs text-slate-400">配置台新證券 SDK 所需之金鑰與憑證</p>
                </div>

                {/* File Upload Section */}
                <div className="p-5 bg-slate-50 rounded-xl border border-slate-150 space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-700">🔐 上傳台新憑證檔案 (.pfx)</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5">請上傳從台新金網下載的 API 電子憑證檔</p>
                  </div>
                  <div className="flex gap-4 items-center">
                    <input 
                      type="file"
                      accept=".pfx"
                      onChange={e => setTaishinCertFile(e.target.files?.[0] || null)}
                      className="text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    <button
                      type="button"
                      onClick={() => handleUploadCert("taishin")}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-1.5 rounded-lg text-xs transition-colors"
                    >
                      開始上傳
                    </button>
                  </div>
                  <div className="text-xs flex items-center gap-2 mt-1">
                    <span className="font-bold text-slate-500">憑證狀態：</span>
                    {settingsData?.cert_statuses.taishin ? (
                      <span className="text-green-600 font-bold">● 已安裝 (Taishin.pfx)</span>
                    ) : (
                      <span className="text-red-500 font-bold">○ 尚未安裝 (請上傳)</span>
                    )}
                  </div>
                </div>

                {/* API Credentials Form */}
                <form onSubmit={handleSave} className="space-y-4 pt-4 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5">身分證字號 / 帳戶 ID</label>
                    <input
                      type="text"
                      value={taishinAccount}
                      onChange={e => setTaishinAccount(e.target.value)}
                      placeholder="請輸入身分證字號"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1.5">API Key</label>
                      <input
                        type="password"
                        value={taishinApiKey}
                        onChange={e => setTaishinApiKey(e.target.value)}
                        placeholder={settingsData?.taishin_api_key || "未設定"}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1.5">API Secret</label>
                      <input
                        type="password"
                        value={taishinApiSecret}
                        onChange={e => setTaishinApiSecret(e.target.value)}
                        placeholder="留空代表不修改"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5">憑證解密密碼 (Cert Password)</label>
                    <input
                      type="password"
                      value={taishinCertPassword}
                      onChange={e => setTaishinCertPassword(e.target.value)}
                      placeholder={settingsData?.has_taishin_cert_password ? "****** (已設定)" : "請輸入憑證密碼"}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
                    >
                      儲存變更
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTestConnection("taishin")}
                      disabled={testingBroker === "taishin"}
                      className="border border-blue-600 hover:bg-blue-50 text-blue-600 font-bold px-6 py-2 rounded-xl text-sm transition-all duration-200 disabled:opacity-50"
                    >
                      {testingBroker === "taishin" ? "測試中..." : "測試 API 連線"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Sinopac Tab */}
            {activeTab === "sinopac" && (
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 mb-1">永豐金證券 (Sinopac Securities)</h3>
                  <p className="text-xs text-slate-400">配置永豐金 Shioaji SDK 所需之憑證與 API 金鑰</p>
                </div>

                {/* File Upload Section */}
                <div className="p-5 bg-slate-50 rounded-xl border border-slate-150 space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-700">🔐 上傳永豐金憑證檔案 (.pfx)</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5">請上傳從永豐金網站下載的 API 電子憑證檔</p>
                  </div>
                  <div className="flex gap-4 items-center">
                    <input 
                      type="file"
                      accept=".pfx"
                      onChange={e => setSinopacCertFile(e.target.files?.[0] || null)}
                      className="text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    <button
                      type="button"
                      onClick={() => handleUploadCert("sinopac")}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-1.5 rounded-lg text-xs transition-colors"
                    >
                      開始上傳
                    </button>
                  </div>
                  <div className="text-xs flex items-center gap-2 mt-1">
                    <span className="font-bold text-slate-500">憑證狀態：</span>
                    {settingsData?.cert_statuses.sinopac ? (
                      <span className="text-green-600 font-bold">● 已安裝 (Sinopac.pfx)</span>
                    ) : (
                      <span className="text-red-500 font-bold">○ 尚未安裝 (請上傳)</span>
                    )}
                  </div>
                </div>

                {/* API Credentials Form */}
                <form onSubmit={handleSave} className="space-y-4 pt-4 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5">身分證字號 / 帳戶 ID</label>
                    <input
                      type="text"
                      value={sinopacAccount}
                      onChange={e => setSinopacAccount(e.target.value)}
                      placeholder="請輸入身分證字號"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1.5">API Key</label>
                      <input
                        type="password"
                        value={sinopacApiKey}
                        onChange={e => setSinopacApiKey(e.target.value)}
                        placeholder={settingsData?.sinopac_api_key || "未設定"}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1.5">API Secret</label>
                      <input
                        type="password"
                        value={sinopacApiSecret}
                        onChange={e => setSinopacApiSecret(e.target.value)}
                        placeholder="留空代表不修改"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5">憑證解密密碼 (Cert Password)</label>
                    <input
                      type="password"
                      value={sinopacCertPassword}
                      onChange={e => setSinopacCertPassword(e.target.value)}
                      placeholder={settingsData?.has_sinopac_cert_password ? "****** (已設定)" : "請輸入憑證密碼"}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
                    >
                      儲存變更
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTestConnection("sinopac")}
                      disabled={testingBroker === "sinopac"}
                      className="border border-blue-600 hover:bg-blue-50 text-blue-600 font-bold px-6 py-2 rounded-xl text-sm transition-all duration-200 disabled:opacity-50"
                    >
                      {testingBroker === "sinopac" ? "測試中..." : "測試 API 連線"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* E-Sun Tab */}
            {activeTab === "esun" && (
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 mb-1">玉山證券 (E-Sun Securities)</h3>
                  <p className="text-xs text-slate-400">配置玉山證券 API、網銀登入帳密與下單電子憑證 (.p12)</p>
                </div>

                {/* File Upload Section */}
                <div className="p-5 bg-slate-50 rounded-xl border border-slate-150 space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-700">🔐 上傳玉山憑證檔案 (.p12)</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5">請上傳檔名為 `esun_cert_20270611.p12` 的玉山 API 電子憑證</p>
                  </div>
                  <div className="flex gap-4 items-center">
                    <input 
                      type="file"
                      accept=".p12"
                      onChange={e => setEsunCertFile(e.target.files?.[0] || null)}
                      className="text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    <button
                      type="button"
                      onClick={() => handleUploadCert("esun")}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-1.5 rounded-lg text-xs transition-colors"
                    >
                      開始上傳
                    </button>
                  </div>
                  <div className="text-xs flex items-center gap-2 mt-1">
                    <span className="font-bold text-slate-500">憑證狀態：</span>
                    {settingsData?.cert_statuses.esun ? (
                      <span className="text-green-600 font-bold">● 已安裝 (esun_cert_20270611.p12)</span>
                    ) : (
                      <span className="text-red-500 font-bold">○ 尚未安裝 (請上傳)</span>
                    )}
                  </div>
                </div>

                {/* API Connection Test */}
                <div className="pt-6 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => handleTestConnection("esun")}
                    disabled={testingBroker === "esun"}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2.5 rounded-xl text-sm transition-all shadow-sm disabled:opacity-50"
                  >
                    {testingBroker === "esun" ? "測試中..." : "測試 API 連線"}
                  </button>
                </div>
              </div>
            )}

            {/* Invite Friend Tab */}
            {activeTab === "invite" && userRole === "admin" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 mb-1">邀請好友加入 pocketCFO</h3>
                  <p className="text-xs text-slate-400">請輸入您想邀請之好友的電子信箱，系統將會產生 6 位數驗證碼並寄送邀請信。</p>
                </div>
                
                <form onSubmit={handleInviteSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5">好友電子信箱</label>
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="friend@example.com"
                      disabled={isSendingInvite}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    />
                  </div>
                  
                  {inviteError && (
                    <div className="text-xs font-semibold text-rose-500 flex items-center gap-1.5 animate-in fade-in">
                      <span>⚠️</span>
                      <span>{inviteError}</span>
                    </div>
                  )}

                  {inviteSuccess && (
                    <div className="text-xs font-semibold text-emerald-600 flex items-center gap-1.5 animate-in fade-in">
                      <span>✅</span>
                      <span>{inviteSuccess}</span>
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isSendingInvite || !inviteEmail.trim()}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
                    >
                      {isSendingInvite ? "寄送中..." : "寄送邀請函"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Scheduler Status Tab */}
            {activeTab === "scheduler" && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 mb-1">自動同步排程狀態</h3>
                    <p className="text-xs text-slate-500">
                      確認每日下午 17:00 (台北時間) 的自動同步 API 是否成功撈取交易明細與持股餘額。
                    </p>
                  </div>
                  <button
                    onClick={fetchSchedulerStatus}
                    disabled={isLoadingScheduler}
                    className="border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold px-4 py-2 rounded-xl text-xs transition-all duration-200 disabled:opacity-50"
                  >
                    {isLoadingScheduler ? "重新整理中..." : "🔄 重新整理狀態"}
                  </button>
                </div>

                {isLoadingScheduler ? (
                  <div className="py-10 text-center text-sm text-slate-500">載入排程狀態中...</div>
                ) : (
                  <div className="space-y-4">
                    {/* Last Sync Day Card */}
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 flex justify-between items-center">
                      <span className="text-sm font-semibold text-slate-700">最後排程資產同步日期</span>
                      <span className="text-sm font-bold text-blue-600">
                        {schedulerStatus?.last_asset_sync_day || "尚未執行過"}
                      </span>
                    </div>

                    {/* Scheduler Status List */}
                    <div className="border border-slate-100 rounded-xl overflow-hidden">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="px-4 py-3 font-semibold text-slate-600">同步服務</th>
                            <th className="px-4 py-3 font-semibold text-slate-600">狀態</th>
                            <th className="px-4 py-3 font-semibold text-slate-600">最後執行時間 (台北時間)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { key: "taishin_trades", name: "台新證券 - 股票交易明細" },
                            { key: "taishin_assets", name: "台新證券 - 資產與股票庫存" },
                            { key: "esun_trades", name: "玉山證券 - 股票交易明細" },
                            { key: "esun_assets", name: "玉山證券 - 資產與股票庫存" },
                          ].map((item) => {
                            const history = schedulerStatus?.sync_history?.[item.key];
                            return (
                              <tr key={item.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                                <td className="px-4 py-4 font-medium text-slate-800">{item.name}</td>
                                <td className="px-4 py-4">
                                  {history ? (
                                    history.status === "success" ? (
                                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                        ● 同步成功
                                      </span>
                                    ) : (
                                      <div className="space-y-1">
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-100">
                                          ● 同步失敗
                                        </span>
                                        {history.error && (
                                          <p className="text-[11px] text-rose-500 max-w-[200px] break-all leading-normal">
                                            {history.error}
                                          </p>
                                        )}
                                      </div>
                                    )
                                  ) : (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-50 text-slate-500 border border-slate-100">
                                      ● 尚未執行
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-4 text-slate-500">
                                  {history?.time || "-"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="pt-4 flex justify-end">
                      <button
                        onClick={handleManualSync}
                        disabled={isSyncing}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2.5 rounded-xl text-sm transition-all shadow-sm disabled:opacity-50 flex items-center gap-2"
                      >
                        {isSyncing ? "同步中..." : "🚀 立即執行自動同步 (同步最新數據)"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

      </div>

    </div>
  );
}
