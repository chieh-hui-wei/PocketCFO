import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { registerUser } from "../services/api";

export default function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isErrorShake, setIsErrorShake] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim() || !pinCode.trim()) return;

    setIsSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");
    setIsErrorShake(false);

    try {
      await registerUser(email.trim(), password, pinCode.trim());
      setSuccessMsg("帳戶註冊成功！將在 3 秒後自動導向登入頁面...");
      setTimeout(() => {
        navigate("/login");
      }, 3000);
    } catch (err: any) {
      console.error("Registration failed:", err);
      const detail = err.response?.data?.detail || "註冊失敗，請確認驗證碼與信箱正確";
      setErrorMsg(detail);
      setIsErrorShake(true);
      setTimeout(() => setIsErrorShake(false), 500);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-[#090d16] overflow-hidden font-sans select-none">
      
      {/* Self-contained styling for floating & shake animations */}
      <style>{`
        @keyframes float-slow-1 {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          50% { transform: translate(30px, -40px) scale(1.15); }
        }
        @keyframes float-slow-2 {
          0%, 100% { transform: translate(0px, 0px) scale(1.1); }
          50% { transform: translate(-40px, 30px) scale(0.9); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-6px); }
          20%, 40%, 60%, 80% { transform: translateX(6px); }
        }
        .animate-float-1 {
          animation: float-slow-1 12s ease-in-out infinite;
        }
        .animate-float-2 {
          animation: float-slow-2 15s ease-in-out infinite;
        }
        .animate-shake {
          animation: shake 0.4s ease-in-out;
        }
      `}</style>

      {/* Decorative background blobs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-blue-600/20 blur-[120px] pointer-events-none animate-float-1" />
      <div className="absolute bottom-1/4 right-1/4 w-[450px] h-[450px] rounded-full bg-indigo-500/20 blur-[130px] pointer-events-none animate-float-2" />
      <div className="absolute top-1/2 left-2/3 w-80 h-80 rounded-full bg-purple-500/10 blur-[100px] pointer-events-none animate-float-1" />

      {/* Grid Pattern overlay for depth */}
      <div 
        className="absolute inset-0 bg-[radial-gradient(transparent_1px,#0d1323_1px)] bg-[size:20px_20px] opacity-20 pointer-events-none"
        style={{ maskImage: "radial-gradient(ellipse at center, black, transparent 80%)" }}
      />

      {/* Card Wrapper */}
      <div 
        className={`relative w-full max-w-[440px] mx-4 transition-all duration-300 ${
          isErrorShake ? "animate-shake" : ""
        }`}
      >
        {/* Glassmorphic Card Container */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-10 shadow-2xl shadow-black/40">
          
          {/* Logo & Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-600 text-white font-extrabold text-2xl shadow-lg shadow-blue-500/25 mb-4">
              P
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">註冊新帳戶</h2>
            <p className="text-xs text-slate-400 mt-2 font-medium">請輸入管理員寄送的信箱驗證碼以啟用帳戶</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                電子信箱 (作為帳號)
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
                disabled={isSubmitting}
                className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 focus:border-blue-500/80 focus:ring-2 focus:ring-blue-500/10 focus:outline-none rounded-xl text-sm text-white transition-all duration-200 placeholder-slate-650 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                設定登入密碼
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="請輸入您自訂的密碼..."
                disabled={isSubmitting}
                className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 focus:border-blue-500/80 focus:ring-2 focus:ring-blue-500/10 focus:outline-none rounded-xl text-sm text-white transition-all duration-200 placeholder-slate-650 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                6 位數電子郵件驗證碼 (PIN)
              </label>
              <input
                type="text"
                required
                maxLength={6}
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                disabled={isSubmitting}
                className="w-full px-4 py-3 text-center tracking-[12px] font-mono text-lg bg-slate-950/50 border border-slate-800 focus:border-blue-500/80 focus:ring-2 focus:ring-blue-500/10 focus:outline-none rounded-xl text-white transition-all duration-200 placeholder-slate-700 disabled:opacity-50"
              />
            </div>

            {/* Notifications */}
            {errorMsg && (
              <div className="text-xs font-semibold text-rose-500 mt-2 flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
                <span>⚠️</span>
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="text-xs font-semibold text-emerald-400 mt-2 flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
                <span>✅</span>
                <span>{successMsg}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || !email.trim() || !password.trim() || pinCode.length !== 6}
              className="relative w-full overflow-hidden group py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-sm font-bold transition-all duration-300 shadow-md shadow-blue-500/15 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
            >
              {isSubmitting ? (
                <div className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>註冊驗證中...</span>
                </div>
              ) : (
                <span>驗證並完成註冊</span>
              )}
              <div className="absolute inset-0 w-1/2 h-full bg-white/10 skew-x-[-25deg] translate-x-[-120%] group-hover:translate-x-[250%] transition-transform duration-1000 ease-out pointer-events-none" />
            </button>
          </form>

          {/* Links */}
          <div className="text-center mt-6">
            <Link to="/login" className="text-xs text-blue-400 hover:underline font-semibold transition-all duration-200">
              已有帳戶？返回登入頁面
            </Link>
          </div>

        </div>

      </div>

    </div>
  );
}
