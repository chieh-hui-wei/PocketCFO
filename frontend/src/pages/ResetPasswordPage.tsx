import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { forgotPassword, resetPassword } from "../services/api";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isErrorShake, setIsErrorShake] = useState(false);

  const triggerShake = () => {
    setIsErrorShake(true);
    setTimeout(() => setIsErrorShake(false), 500);
  };

  const handleRequestPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await forgotPassword(email.trim());
      setSuccessMsg(res.message || "驗證碼已寄出，請檢查您的信箱");
      setStep(2);
    } catch (err: any) {
      console.error(err);
      const detail = err.response?.data?.detail || "發送驗證碼失敗，請確認信箱正確且已註冊";
      setErrorMsg(detail);
      triggerShake();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !pinCode.trim() || !newPassword.trim() || !confirmPassword.trim()) return;

    if (newPassword !== confirmPassword) {
      setErrorMsg("兩次輸入的密碼不一致");
      triggerShake();
      return;
    }

    if (newPassword.length < 6) {
      setErrorMsg("密碼長度必須大於或等於 6 個字元");
      triggerShake();
      return;
    }

    setIsSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await resetPassword(email.trim(), pinCode.trim(), newPassword);
      setSuccessMsg(res.message || "密碼重設成功！3 秒後將為您導向至登入頁面...");
      setTimeout(() => {
        navigate("/login");
      }, 3000);
    } catch (err: any) {
      console.error(err);
      const detail = err.response?.data?.detail || "重設密碼失敗，請確認驗證碼正確且尚未過期";
      setErrorMsg(detail);
      triggerShake();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-[#090d16] overflow-hidden font-sans select-none">
      
      {/* Self-contained styling for animations */}
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

      {/* Background decoration blobs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-blue-600/20 blur-[120px] pointer-events-none animate-float-1" />
      <div className="absolute bottom-1/4 right-1/4 w-[450px] h-[450px] rounded-full bg-indigo-500/20 blur-[130px] pointer-events-none animate-float-2" />

      {/* Grid Pattern overlay */}
      <div 
        className="absolute inset-0 bg-[radial-gradient(transparent_1px,#0d1323_1px)] bg-[size:20px_20px] opacity-20 pointer-events-none"
        style={{ maskImage: "radial-gradient(ellipse at center, black, transparent 80%)" }}
      />

      <div className={`relative w-full max-w-[420px] mx-4 transition-all duration-300 ${isErrorShake ? "animate-shake" : ""}`}>
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-10 shadow-2xl shadow-black/40">
          
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-600 text-white font-extrabold text-2xl shadow-lg shadow-blue-500/25 mb-4">
              P
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">重設密碼</h2>
            <p className="text-xs text-slate-400 mt-2 font-medium">個人財務與資產分配監控系統</p>
          </div>

          {step === 1 ? (
            <form onSubmit={handleRequestPin} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                  您的註冊電子信箱
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  disabled={isSubmitting}
                  className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 focus:border-blue-500/80 focus:ring-2 focus:ring-blue-500/10 focus:outline-none rounded-xl text-sm text-white transition-all duration-200 placeholder-slate-600 disabled:opacity-50"
                  autoFocus
                />
              </div>

              {errorMsg && (
                <div className="text-xs font-semibold text-rose-500 mt-2 flex items-center gap-1.5 animate-in fade-in">
                  <span>⚠️</span>
                  <span>{errorMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || !email.trim()}
                className="relative w-full overflow-hidden group py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-sm font-bold transition-all duration-300 shadow-md shadow-blue-500/15 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              >
                {isSubmitting ? "發送中..." : "取得重設驗證碼"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                  電子郵件驗證碼 (6位數)
                </label>
                <input
                  type="text"
                  required
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value)}
                  placeholder="請輸入 6 位數驗證碼"
                  maxLength={6}
                  disabled={isSubmitting}
                  className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 focus:border-blue-500/80 focus:ring-2 focus:ring-blue-500/10 focus:outline-none rounded-xl text-sm text-white transition-all duration-200 placeholder-slate-600 text-center font-bold tracking-[8px] disabled:opacity-50"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                  新密碼 (至少 6 個字元)
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="請設定新密碼..."
                  disabled={isSubmitting}
                  className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 focus:border-blue-500/80 focus:ring-2 focus:ring-blue-500/10 focus:outline-none rounded-xl text-sm text-white transition-all duration-200 placeholder-slate-600 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                  確認新密碼
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="請再次輸入密碼..."
                  disabled={isSubmitting}
                  className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 focus:border-blue-500/80 focus:ring-2 focus:ring-blue-500/10 focus:outline-none rounded-xl text-sm text-white transition-all duration-200 placeholder-slate-600 disabled:opacity-50"
                />
              </div>

              {errorMsg && (
                <div className="text-xs font-semibold text-rose-500 mt-2 flex items-center gap-1.5 animate-in fade-in">
                  <span>⚠️</span>
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="text-xs font-semibold text-emerald-400 mt-2 flex items-center gap-1.5 animate-in fade-in">
                  <span>✅</span>
                  <span>{successMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || !pinCode.trim() || !newPassword.trim() || !confirmPassword.trim()}
                className="relative w-full overflow-hidden group py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-sm font-bold transition-all duration-300 shadow-md shadow-blue-500/15 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              >
                {isSubmitting ? "更新中..." : "重設密碼"}
              </button>
            </form>
          )}

          <div className="text-center mt-6">
            <Link to="/login" className="text-xs text-blue-400 hover:underline font-semibold transition-all duration-200">
              返回登入頁面
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
