import React, { useState } from "react";
import { Link } from "react-router-dom";
import { login } from "../services/api";

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isErrorShake, setIsErrorShake] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;

    setIsSubmitting(true);
    setErrorMsg("");
    setIsErrorShake(false);

    try {
      await login(email.trim(), password);
      onLogin();
    } catch (err: any) {
      console.error("Login failed:", err);
      const detail = err.response?.data?.detail || "帳號或密碼錯誤，請重新輸入";
      setErrorMsg(detail);
      setIsErrorShake(true);
      // Remove shake class after animation runs so it can be re-triggered
      setTimeout(() => setIsErrorShake(false), 500);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-[#090d16] overflow-hidden font-sans select-none">
      
      {/* Self-contained styling for smooth background floating & shake animations */}
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
        className={`relative w-full max-w-[420px] mx-4 transition-all duration-300 ${
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
            <h2 className="text-2xl font-bold tracking-tight text-white">pocketCFO</h2>
            <p className="text-xs text-slate-400 mt-2 font-medium">個人財務與資產分配監控系統</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                電子信箱 (帳號)
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
                disabled={isSubmitting}
                className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 focus:border-blue-500/80 focus:ring-2 focus:ring-blue-500/10 focus:outline-none rounded-xl text-sm text-white transition-all duration-200 placeholder-slate-655 disabled:opacity-50"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                登入密碼
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="請輸入密碼..."
                disabled={isSubmitting}
                className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 focus:border-blue-500/80 focus:ring-2 focus:ring-blue-500/10 focus:outline-none rounded-xl text-sm text-white transition-all duration-200 placeholder-slate-655 disabled:opacity-50"
              />
              
              {/* Error messages */}
              {errorMsg && (
                <div className="text-xs font-semibold text-rose-500 mt-2 flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
                  <span>⚠️</span>
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || !email.trim() || !password.trim()}
              className="relative w-full overflow-hidden group py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-sm font-bold transition-all duration-300 shadow-md shadow-blue-500/15 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
            >
              {isSubmitting ? (
                <div className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>驗證中...</span>
                </div>
              ) : (
                <span>解鎖並進入系統</span>
              )}
              {/* Gradient shimmer effect on hover */}
              <div className="absolute inset-0 w-1/2 h-full bg-white/10 skew-x-[-25deg] translate-x-[-120%] group-hover:translate-x-[250%] transition-transform duration-1000 ease-out pointer-events-none" />
            </button>
          </form>

          {/* Links */}
          <div className="text-center mt-6 flex flex-col gap-2.5">
            <Link to="/register" className="text-xs text-blue-400 hover:underline font-semibold transition-all duration-200">
              收到邀請？前往註冊帳戶
            </Link>
            <Link to="/reset-password" className="text-xs text-slate-400 hover:text-slate-200 hover:underline font-medium transition-all duration-200">
              忘記密碼？
            </Link>
          </div>


        </div>

        {/* Footer info */}
        <p className="text-center text-[10px] text-slate-600 mt-6 font-medium">
          若尚未設定，請使用預設帳號 `admin@pocketcfo.com` 與密碼 `admin`。
        </p>
      </div>

    </div>
  );
}
