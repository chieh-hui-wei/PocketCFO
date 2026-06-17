import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import BalanceSheetPage from "./pages/BalanceSheetPage";
import IncomeStatementPage from "./pages/IncomeStatementPage";
import UploadPage from "./pages/UploadPage";
import UploadHistoryPage from "./pages/UploadHistoryPage";
import TransactionsPage from "./pages/TransactionsPage";
import StockTransactionsPage from "./pages/StockTransactionsPage";
import StockHoldingsPage from "./pages/StockHoldingsPage";
import AccountsPage from "./pages/AccountsPage";
import SettingsPage from "./pages/SettingsPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";

const NAV = [
  { to: "/", label: "總覽", end: true },
  { to: "/balance-sheet", label: "資產負債表" },
  { to: "/income-statement", label: "損益表" },
  { to: "/stock-holdings", label: "股票庫存" },
  { to: "/transactions", label: "交易明細" },
  { to: "/stock-transactions", label: "股票交易明細" },
  { to: "/accounts", label: "帳戶管理" },
  { to: "/upload", label: "上傳對帳單" },
  { to: "/upload-history", label: "上傳紀錄" },
  { to: "/settings", label: "設定" },
];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    !!localStorage.getItem("pocketcfo_token")
  );

  const [userEmail, setUserEmail] = useState<string>("");
  const [userRole, setUserRole] = useState<string>("");

  useEffect(() => {
    const handleUnauthorized = () => {
      setIsAuthenticated(false);
      localStorage.removeItem("pocketcfo_token");
      localStorage.removeItem("pocketcfo_user");
    };
    window.addEventListener("pocketcfo_unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("pocketcfo_unauthorized", handleUnauthorized);
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      try {
        const userStr = localStorage.getItem("pocketcfo_user");
        if (userStr) {
          const user = JSON.parse(userStr);
          if (user) {
            setUserEmail(user.email || "");
            setUserRole(user.role || "");
          }
        }
      } catch (e) {
        console.error("Failed to parse user from localStorage", e);
      }
    } else {
      setUserEmail("");
      setUserRole("");
    }
  }, [isAuthenticated]);

  const handleLogout = () => {
    localStorage.removeItem("pocketcfo_token");
    localStorage.removeItem("pocketcfo_user");
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="*" element={<LoginPage onLogin={() => setIsAuthenticated(true)} />} />
        </Routes>
      </BrowserRouter>
    );
  }

  // Display name: email prefix capitalized or email itself
  const displayName = userEmail ? userEmail.split("@")[0] : "Sarah";

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#f8fafc] text-slate-800 font-sans flex">
        
        {/* Left Sidebar */}
        <aside className="w-[260px] bg-white border-r border-slate-200 flex flex-col shrink-0 fixed h-full z-20">
          
          {/* User Profile */}
          <div className="p-6 border-b border-slate-100 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-blue-100 overflow-hidden flex items-center justify-center text-lg font-bold text-blue-600 border-2 border-white shadow-sm uppercase">
              {displayName.slice(0, 1) || "U"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-slate-800 text-base leading-tight truncate">Hi, {displayName}</div>
              <div className="text-[10px] text-slate-400 font-medium mt-0.5 truncate">
                {userEmail || "理財讓生活更自由"}
              </div>
              {userRole === "admin" && (
                <span className="inline-block bg-amber-50 text-amber-700 text-[8px] font-bold px-1.5 py-0.5 rounded border border-amber-200 mt-1 uppercase">
                  Admin
                </span>
              )}
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 ${
                    isActive
                       ? "bg-blue-50 text-blue-600 shadow-sm"
                       : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}

            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition-all duration-200 mt-4"
            >
              登出系統
            </button>
          </nav>

          {/* Bottom Widget: Monthly Goal */}
          <div className="p-5 border-t border-slate-100 bg-slate-50/50 m-3 rounded-2xl">
            <div className="text-xs font-bold text-slate-600 mb-1">本月小目標</div>
            <div className="text-sm font-bold text-slate-800 mb-3">存下 $15,000</div>
            <div className="w-full bg-slate-200 rounded-full h-1.5 mb-1.5 overflow-hidden">
              <div className="bg-blue-500 h-1.5 rounded-full w-[75%]" />
            </div>
            <div className="text-right text-[10px] font-bold text-slate-400">75%</div>
          </div>

        </aside>

        {/* Main Content Area */}
        <main className="ml-[260px] flex-1 p-8 min-h-screen">
          <div className="max-w-[1200px] mx-auto">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/balance-sheet" element={<BalanceSheetPage />} />
              <Route path="/income-statement" element={<IncomeStatementPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/stock-transactions" element={<StockTransactionsPage />} />
              <Route path="/stock-holdings" element={<StockHoldingsPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/upload-history" element={<UploadHistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </main>

      </div>
    </BrowserRouter>
  );
}
