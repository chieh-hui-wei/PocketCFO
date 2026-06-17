import React, { useEffect, useState } from "react";
import { getSettings, saveSettings, uploadCertificate, CredentialsSettings, inviteFriend, updateProfile } from "../services/api";

export default function SettingsPage() {
  const [settingsData, setSettingsData] = useState<CredentialsSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"profile" | "general" | "taishin" | "sinopac" | "esun" | "invite">("profile");
  const [userRole, setUserRole] = useState<string>("");

  // Profile update states
  const [profileEmail, setProfileEmail] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [profileConfirmPassword, setProfileConfirmPassword] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState("");
  const [profileError, setProfileError] = useState("");

  // Invite Friend states
  const [inviteEmail, setInviteEmail] = useState("");
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");


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
        alert("未輸入任何修改資訊");
        setIsSaving(false);
        return;
      }

      const res = await saveSettings(payload);
      alert(res.message || "設定儲存成功！");
      fetchSettings();
    } catch (e) {
      console.error(e);
      alert("儲存設定失敗");
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
      alert("請先選擇憑證檔案");
      return;
    }

    try {
      await uploadCertificate(file, broker);
      alert(`${broker === "taishin" ? "台新證券" : broker === "sinopac" ? "永豐金證券" : "玉山證券"} 憑證上傳成功！`);
      if (broker === "taishin") setTaishinCertFile(null);
      if (broker === "sinopac") setSinopacCertFile(null);
      if (broker === "esun") setEsunCertFile(null);
      fetchSettings();
    } catch (e) {
      console.error(e);
      alert("上傳憑證失敗");
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
                <div className="pt-4 border-t border-slate-100">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
                  >
                    儲存變更
                  </button>
                </div>
              </form>
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

                  <div className="pt-4 border-t border-slate-100">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
                    >
                      儲存變更
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

                  <div className="pt-4 border-t border-slate-100">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
                    >
                      儲存變更
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

                {/* API Credentials Form */}
                <form onSubmit={handleSave} className="space-y-4 pt-4 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5">玉山證券 / 網銀帳戶 (身分證字號)</label>
                    <input
                      type="text"
                      value={esunAccount}
                      onChange={e => setEsunAccount(e.target.value)}
                      placeholder="請輸入身分證字號"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1.5">網銀密碼 (Password)</label>
                      <input
                        type="password"
                        value={esunPassword}
                        onChange={e => setEsunPassword(e.target.value)}
                        placeholder={settingsData?.has_esun_password ? "****** (已設定)" : "請輸入網銀密碼"}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1.5">憑證解密密碼 (Cert Password)</label>
                      <input
                        type="password"
                        value={esunCertPassword}
                        onChange={e => setEsunCertPassword(e.target.value)}
                        placeholder={settingsData?.has_esun_cert_password ? "****** (已設定)" : "請輸入憑證密碼"}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1.5">API Key</label>
                      <input
                        type="password"
                        value={esunApiKey}
                        onChange={e => setEsunApiKey(e.target.value)}
                        placeholder={settingsData?.esun_api_key || "未設定"}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1.5">API Secret</label>
                      <input
                        type="password"
                        value={esunApiSecret}
                        onChange={e => setEsunApiSecret(e.target.value)}
                        placeholder="留空代表不修改"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50"
                    >
                      儲存變更
                    </button>
                  </div>
                </form>
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

          </div>
        </div>

      </div>

    </div>
  );
}
