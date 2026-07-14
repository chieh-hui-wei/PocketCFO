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
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ToastContainer from "./components/ToastContainer";
import { getDailyTip, getSavingsPots, SavingsPot } from "./services/api";

const NAV_GROUPS = [
  {
    title: "財務分析",
    items: [
      { 
        to: "/", 
        label: "財務總覽", 
        end: true,
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        )
      },
      { 
        to: "/balance-sheet", 
        label: "資產負債表",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        )
      },
      { 
        to: "/income-statement", 
        label: "損益表",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        )
      },
    ]
  },
  {
    title: "交易與資產",
    items: [
      { 
        to: "/transactions", 
        label: "交易明細",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
        )
      },
      { 
        to: "/stock-holdings", 
        label: "股票庫存",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
          </svg>
        )
      },
      { 
        to: "/stock-transactions", 
        label: "股票交易明細",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21h8a2 2 0 002-2v-9a2 2 0 00-2-2H8a2 2 0 00-2 2v9a2 2 0 002 2z" />
          </svg>
        )
      },
    ]
  },
  {
    title: "工具與管理",
    items: [
      { 
        to: "/upload", 
        label: "上傳對帳單",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        )
      },
      { 
        to: "/accounts", 
        label: "帳戶管理",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
        )
      },
      { 
        to: "/settings", 
        label: "設定",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )
      },
    ]
  }
];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    !!localStorage.getItem("pocketcfo_token")
  );

  const [userEmail, setUserEmail] = useState<string>("");
  const [userRole, setUserRole] = useState<string>("");
  const [dailyTip, setDailyTip] = useState<string>("理財小妙招載入中...");
  const [closestPot, setClosestPot] = useState<SavingsPot | null>(null);

  const fetchDailyTipAndPots = async (forceRefresh: boolean = false) => {
    // Get YYYY-MM-DD date in Taipei timezone
    const todayStr = new Date().toLocaleDateString("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).replace(/\//g, "-");

    const cachedTip = localStorage.getItem("pocketcfo_daily_tip");
    const cachedDate = localStorage.getItem("pocketcfo_daily_tip_date");

    if (!forceRefresh && cachedTip && cachedDate === todayStr) {
      setDailyTip(cachedTip);
    } else {
      try {
        const tipRes = await getDailyTip();
        if (tipRes && tipRes.tip) {
          setDailyTip(tipRes.tip);
          localStorage.setItem("pocketcfo_daily_tip", tipRes.tip);
          localStorage.setItem("pocketcfo_daily_tip_date", todayStr);
        }
      } catch (e) {
        console.error("Failed to fetch daily tip", e);
        setDailyTip("先存錢、後消費：每月發薪後，先將預算存入儲蓄帳戶，剩下的才是可支配所得。");
      }
    }

    try {
      const potsRes = await getSavingsPots();
      if (potsRes && potsRes.pots && potsRes.pots.length > 0) {
        // Find the pot closest to 100% completion
        const sorted = [...potsRes.pots].sort((a, b) => {
          const ratioA = a.target_amount > 0 ? a.allocated_amount / a.target_amount : 0;
          const ratioB = b.target_amount > 0 ? b.allocated_amount / b.target_amount : 0;
          return ratioB - ratioA; // descending order
        });
        setClosestPot(sorted[0]);
      } else {
        setClosestPot(null);
      }
    } catch (e) {
      console.error("Failed to fetch pots for sidebar", e);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchDailyTipAndPots();
    }
  }, [isAuthenticated]);

  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("pocketcfo_sidebar_collapsed") === "true";
  });

  const toggleSidebar = () => {
    setIsCollapsed(prev => {
      const newVal = !prev;
      localStorage.setItem("pocketcfo_sidebar_collapsed", String(newVal));
      return newVal;
    });
  };

  useEffect(() => {
    // Check if the token has expired (24 hours)
    const loginTime = localStorage.getItem("pocketcfo_login_time");
    if (loginTime) {
      const elapsed = Date.now() - parseInt(loginTime);
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      if (elapsed > TWENTY_FOUR_HOURS) {
        handleLogout();
      }
    } else if (localStorage.getItem("pocketcfo_token")) {
      // If token exists but no login time was saved (old session), set current time as baseline
      localStorage.setItem("pocketcfo_login_time", String(Date.now()));
    }

    const handleUnauthorized = () => {
      setIsAuthenticated(false);
      localStorage.removeItem("pocketcfo_token");
      localStorage.removeItem("pocketcfo_user");
      localStorage.removeItem("pocketcfo_login_time");
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
    localStorage.removeItem("pocketcfo_login_time");
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return (
      <BrowserRouter>
        <ToastContainer />
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="*" element={<LoginPage onLogin={() => setIsAuthenticated(true)} />} />
        </Routes>
      </BrowserRouter>
    );
  }

  // Display name: email prefix capitalized or email itself
  const displayName = userEmail ? userEmail.split("@")[0] : "Sarah";

  return (
    <BrowserRouter>
      <ToastContainer />
      <div className="min-h-screen bg-[#f8fafc] text-slate-800 font-sans flex">
        
        {/* Left Sidebar */}
        <aside className={`${isCollapsed ? "w-[78px]" : "w-[260px]"} bg-white border-r border-slate-200 flex flex-col shrink-0 fixed h-full z-20 transition-all duration-300`}>
          
          {/* Collapse Toggle Button */}
          <button
            onClick={toggleSidebar}
            className="absolute top-5 -right-3 w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:shadow-sm transition-all shadow-sm z-30 cursor-pointer"
            title={isCollapsed ? "展開選單" : "收合選單"}
          >
            {isCollapsed ? (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            )}
          </button>

          {/* User Profile */}
          <div className={`border-b border-slate-100 flex items-center gap-4 transition-all duration-300 ${isCollapsed ? "p-4 justify-center" : "p-6"}`}>
            <div className="w-12 h-12 rounded-full bg-blue-100 overflow-hidden flex items-center justify-center text-lg font-bold text-blue-600 border-2 border-white shadow-sm uppercase shrink-0">
              {displayName.slice(0, 1) || "U"}
            </div>
            {!isCollapsed && (
              <div className="min-w-0 flex-1 animate-in fade-in duration-300">
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
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-4 px-3 space-y-5 overflow-y-auto">
            {NAV_GROUPS.map((group) => (
              <div key={group.title} className="space-y-1">
                {!isCollapsed && (
                  <div className="text-[10px] font-bold text-slate-400 px-4 mb-1.5 tracking-wider uppercase">
                    {group.title}
                  </div>
                )}
                {group.items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.end}
                    title={isCollapsed ? n.label : undefined}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl text-sm font-bold transition-all duration-200 ${
                        isCollapsed ? "justify-center p-3 mb-1" : "px-4 py-2.5"
                      } ${
                        isActive
                           ? "bg-blue-50 text-blue-600 shadow-sm"
                           : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                      }`
                    }
                  >
                    <span className="shrink-0">{n.icon}</span>
                    {!isCollapsed && <span className="truncate">{n.label}</span>}
                  </NavLink>
                ))}
              </div>
            ))}

            <div className="pt-2 border-t border-slate-100">
              <button
                onClick={handleLogout}
                title={isCollapsed ? "登出系統" : undefined}
                className={`w-full flex items-center gap-3 rounded-xl text-sm font-bold text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition-all duration-200 ${
                  isCollapsed ? "justify-center p-3" : "px-4 py-2.5"
                }`}
              >
                <span className="shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </span>
                {!isCollapsed && <span>登出系統</span>}
              </button>
            </div>
          </nav>

          {/* Bottom Widget: Financial Tips & Closest Target Progress */}
          {!isCollapsed && (
            <div className="p-4 border border-slate-100 bg-slate-50/50 m-3 rounded-2xl animate-in fade-in duration-300 relative group">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[11px] font-extrabold text-blue-600 flex items-center gap-1">
                  <span>💡</span> 理財小妙招
                </span>
                <button
                  type="button"
                  onClick={() => fetchDailyTipAndPots(true)}
                  title="重新整理"
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer rounded-lg hover:bg-slate-100"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89" />
                  </svg>
                </button>
              </div>
              <p className="text-xs text-slate-600 font-medium leading-relaxed">
                {dailyTip}
              </p>

              {closestPot && (
                <div className="mt-3 pt-3 border-t border-slate-200/60">
                  <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 mb-1">
                    <span className="truncate max-w-[80px]" title={closestPot.name}>🎯 {closestPot.name}</span>
                    <span>{((closestPot.allocated_amount / closestPot.target_amount) * 100).toFixed(0)}%</span>
                  </div>
                  <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-emerald-500 h-full rounded-full transition-all duration-300" 
                      style={{ width: `${Math.min(100, (closestPot.allocated_amount / closestPot.target_amount) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

        </aside>

        {/* Main Content Area */}
        <main className={`flex-1 p-8 min-h-screen transition-all duration-300 ${isCollapsed ? "ml-[78px]" : "ml-[260px]"}`}>
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
