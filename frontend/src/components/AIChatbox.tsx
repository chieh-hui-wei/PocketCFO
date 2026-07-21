import React, { useState, useRef, useEffect } from "react";
import { sendAIChatStream, executeSQLQuery, ChatMessage, SQLResult } from "../services/api";

export default function AIChatbox() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-flash");
  // Developer mode states
  const [clickCount, setClickCount] = useState(0);
  const [isDevMode, setIsDevMode] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "sql">("chat");
  const [sqlQuery, setSqlQuery] = useState("SELECT * FROM accounts LIMIT 5;");
  const [sqlResult, setSqlResult] = useState<SQLResult | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlExecuting, setSqlExecuting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat history
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Handle header click to toggle developer mode
  const handleHeaderClick = () => {
    const newCount = clickCount + 1;
    setClickCount(newCount);
    if (newCount >= 5) {
      setIsDevMode(!isDevMode);
      setClickCount(0);
      setActiveTab(!isDevMode ? "sql" : "chat");
      // Add notification message
      setMessages((prev) => [
        ...prev,
        {
          role: "model",
          content: !isDevMode 
            ? "⚠️ **Developer Mode Unlocked!** You can now access the database via the SQL Console tab above or by typing `/sql <query>`." 
            : "ℹ️ Developer Mode Disabled."
        }
      ]);
    }
  };

  // Send message
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    
    // Add user message to state
    const newHistory = [...messages, { role: "user", content: userMessage } as ChatMessage];
    setMessages(newHistory);

    // Check if command is a shortcut /sql query
    if (isDevMode && userMessage.toLowerCase().startsWith("/sql ")) {
      const query = userMessage.substring(5).trim();
      setIsLoading(true);
      try {
        const res = await executeSQLQuery(query);
        let tableMarkdown = `Executed SQL: \`${query}\`\n\n`;
        if (res.columns.length > 0) {
          tableMarkdown += "| " + res.columns.join(" | ") + " |\n";
          tableMarkdown += "| " + res.columns.map(() => "---").join(" | ") + " |\n";
          res.rows.slice(0, 10).forEach(row => {
            tableMarkdown += "| " + row.map(v => v === null ? "NULL" : v).join(" | ") + " |\n";
          });
          if (res.rows.length > 10) {
            tableMarkdown += `\n*Showing first 10 of ${res.rows.length} rows.*`;
          }
        } else {
          tableMarkdown += "Query completed successfully. No rows returned.";
        }
        setMessages((prev) => [...prev, { role: "model", content: tableMarkdown }]);
      } catch (err: any) {
        setMessages((prev) => [...prev, { role: "model", content: `❌ **SQL Error:** ${err.response?.data?.detail || err.message}` }]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Call standard Gemini Chat with Streaming
    setIsLoading(true);
    setMessages((prev) => [...prev, { role: "model", content: "" }]);

    try {
      await sendAIChatStream(
        userMessage,
        messages,
        (chunk: string) => {
          setMessages((prev) => {
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            if (lastIndex >= 0 && updated[lastIndex].role === "model") {
              updated[lastIndex] = {
                ...updated[lastIndex],
                content: updated[lastIndex].content + chunk,
              };
            }
            return updated;
          });
        },
        selectedModel
      );
    } catch (err: any) {
      setMessages((prev) => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;
        if (lastIndex >= 0 && updated[lastIndex].role === "model" && !updated[lastIndex].content) {
          updated[lastIndex] = { role: "model", content: `❌ Failed to communicate with AI: ${err.message}` };
        } else {
          updated.push({ role: "model", content: `\n❌ Error: ${err.message}` });
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Run SQL Console query
  const runSQL = async () => {
    if (!sqlQuery.trim() || sqlExecuting) return;
    setSqlExecuting(true);
    setSqlResult(null);
    setSqlError(null);
    try {
      const res = await executeSQLQuery(sqlQuery);
      setSqlResult(res);
    } catch (err: any) {
      setSqlError(err.response?.data?.detail || err.message);
    } finally {
      setSqlExecuting(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 font-sans">
      {/* Toggle Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg hover:shadow-2xl transform hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
          title="開啟 AI 助手"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="w-[420px] h-[550px] bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-200/80 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
          
          {/* Header */}
          <div 
            onClick={handleHeaderClick}
            className="px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex justify-between items-center cursor-pointer select-none shrink-0"
            title="連續點擊 5 下開啟開發者 SQL 模式"
          >
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-extrabold text-sm tracking-wide">pocketCFO AI 智慧助手</span>
              {isDevMode && (
                <span className="bg-amber-400 text-amber-950 text-[10px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider scale-90">
                  Dev Mode
                </span>
              )}
            </div>

            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              {/* Model Selection Dropdown */}
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                className="bg-white/20 text-white text-[11px] font-bold px-2 py-1 rounded border border-white/30 focus:outline-none cursor-pointer focus:bg-indigo-700"
                title="選擇 AI 模型 (若額度超限系統將自動切換至備用模型)"
              >
                <option value="gemini-2.5-flash" className="text-slate-800">Gemini 2.5 Flash</option>
                <option value="gemma-4-26b-it" className="text-slate-800">Gemma 4 26B</option>
                <option value="gemma-4-31b-it" className="text-slate-800">Gemma 4 31B</option>
                <option value="gemini-2.5-pro" className="text-slate-800">Gemini 2.5 Pro</option>
              </select>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                }}
                className="text-white/80 hover:text-white hover:bg-white/10 p-1 rounded transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Dev Mode Tabs */}
          {isDevMode && (
            <div className="flex border-b border-slate-200 bg-slate-50 shrink-0">
              <button
                onClick={() => setActiveTab("chat")}
                className={`flex-1 py-2 text-xs font-bold transition-all border-b-2 ${
                  activeTab === "chat" 
                    ? "border-blue-600 text-blue-600 bg-white" 
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                AI 對話
              </button>
              <button
                onClick={() => setActiveTab("sql")}
                className={`flex-1 py-2 text-xs font-bold transition-all border-b-2 ${
                  activeTab === "sql" 
                    ? "border-blue-600 text-blue-600 bg-white" 
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                SQL 控制台
              </button>
            </div>
          )}

          {/* Content Pane */}
          {activeTab === "chat" ? (
            <>
              {/* Messages Area */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50/50">
                {/* System Initial Welcome */}
                <div className="flex gap-2">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    🤖
                  </div>
                  <div className="bg-white px-3.5 py-2.5 rounded-2xl rounded-tl-none shadow-sm border border-slate-100 max-w-[80%] text-sm text-slate-700 leading-relaxed font-medium">
                    您好！我是您的 pocketCFO 智慧助理。我可以幫您查詢或分析您的財務報表、交易明細或股票持倉。有什麼我可以協助您的嗎？
                  </div>
                </div>

                {messages.map((msg, idx) => (
                  <div key={idx} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      msg.role === "user" ? "bg-indigo-100" : "bg-blue-100"
                    }`}>
                      {msg.role === "user" ? "👤" : "🤖"}
                    </div>
                    <div className={`px-3.5 py-2.5 rounded-2xl max-w-[80%] text-sm leading-relaxed shadow-sm font-medium ${
                      msg.role === "user"
                        ? "bg-indigo-600 text-white rounded-tr-none"
                        : "bg-white text-slate-700 border border-slate-100 rounded-tl-none"
                    }`}>
                      {msg.role === "user" ? msg.content : <MarkdownText content={msg.content} />}
                    </div>
                  </div>
                ))}

                {/* Loading state indicator */}
                {isLoading && (
                  <div className="flex gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      🤖
                    </div>
                    <div className="bg-white px-4 py-3 rounded-2xl rounded-tl-none shadow-sm border border-slate-100 flex items-center gap-1.5">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input form */}
              <form onSubmit={handleSend} className="p-3 border-t border-slate-200/80 bg-white flex gap-2 shrink-0">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isDevMode ? "輸入訊息或以 /sql <查詢> 直接執行..." : "問我些什麼... (e.g. 如何優化被動收入?)"}
                  className="flex-1 px-4 py-2 border border-slate-200 rounded-full text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="p-2.5 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                >
                  <svg className="w-4 h-4 transform rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9-7-9-7v14z" />
                  </svg>
                </button>
              </form>
            </>
          ) : (
            /* Developer SQL panel */
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-900 text-slate-100">
              
              {/* Input Area */}
              <div className="p-3 border-b border-slate-800 shrink-0">
                <div className="text-[10px] font-bold text-slate-400 mb-1.5 tracking-wider uppercase flex justify-between items-center">
                  <span>SQLite Read-only Query</span>
                  <span className="text-amber-500">Only SELECT / WITH allowed</span>
                </div>
                <textarea
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono focus:outline-none focus:border-indigo-500 text-emerald-400 resize-none"
                />
                <div className="flex justify-between items-center mt-2">
                  <div className="flex gap-1.5">
                    <button 
                      onClick={() => setSqlQuery("SELECT * FROM accounts LIMIT 5;")}
                      className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] font-mono text-slate-300 transition-all cursor-pointer"
                    >
                      accounts
                    </button>
                    <button 
                      onClick={() => setSqlQuery("SELECT * FROM transactions ORDER BY txn_date DESC LIMIT 5;")}
                      className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] font-mono text-slate-300 transition-all cursor-pointer"
                    >
                      transactions
                    </button>
                  </div>
                  <button
                    onClick={runSQL}
                    disabled={sqlExecuting}
                    className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-800 disabled:text-slate-500 text-xs font-bold transition-colors cursor-pointer"
                  >
                    {sqlExecuting ? "Executing..." : "Run Query"}
                  </button>
                </div>
              </div>

              {/* Result Area */}
              <div className="flex-1 p-3 overflow-auto text-xs font-mono">
                {sqlError && (
                  <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-900 text-rose-300 leading-relaxed">
                    <strong>Error:</strong> {sqlError}
                  </div>
                )}

                {sqlResult && (
                  <div className="overflow-x-auto">
                    {sqlResult.columns.length > 0 ? (
                      <table className="min-w-full divide-y divide-slate-800">
                        <thead>
                          <tr className="bg-slate-950">
                            {sqlResult.columns.map((col, idx) => (
                              <th key={idx} className="px-2 py-1 text-left text-slate-300 font-bold border-r border-slate-800">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {sqlResult.rows.map((row, rowIdx) => (
                            <tr key={rowIdx} className="hover:bg-slate-800/40">
                              {row.map((val, valIdx) => (
                                <td key={valIdx} className="px-2 py-1 text-slate-400 whitespace-nowrap border-r border-slate-800 max-w-[200px] truncate" title={val || "NULL"}>
                                  {val === null ? <span className="text-slate-600 italic">NULL</span> : val}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="text-slate-500 italic p-4 text-center">
                        Query executed successfully. 0 rows returned.
                      </div>
                    )}
                  </div>
                )}

                {!sqlResult && !sqlError && (
                  <div className="text-slate-500 italic p-4 text-center h-full flex items-center justify-center">
                    Enter SQL query above and click Run Query.
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-extrabold text-slate-900">{part.slice(2, -2)}</strong>;
    }
    const codeParts = part.split(/(`.*?`)/g);
    return codeParts.map((subPart, j) => {
      if (subPart.startsWith('`') && subPart.endsWith('`')) {
        return <code key={j} className="bg-slate-100 text-rose-600 px-1 py-0.5 rounded font-mono text-[10px]">{subPart.slice(1, -1)}</code>;
      }
      return subPart;
    });
  });
}

function MarkdownText({ content }: { content: string }) {
  const elements: React.ReactNode[] = [];
  const lines = content.split('\n');
  let currentTable: string[][] = [];
  let inTable = false;
  
  const flushTable = (key: number) => {
    if (currentTable.length === 0) return;
    // Determine headers
    const hasDivider = currentTable[1] && currentTable[1].some(cell => cell.includes('---'));
    const headers = hasDivider ? currentTable[0] : [];
    const rows = hasDivider ? currentTable.slice(2) : currentTable;
    
    elements.push(
      <div key={`table-${key}`} className="overflow-x-auto my-2 border border-slate-200 rounded-lg">
        <table className="min-w-full divide-y divide-slate-200 text-[11px] bg-white">
          {headers.length > 0 && (
            <thead className="bg-slate-50">
              <tr>
                {headers.map((h, idx) => (
                  <th key={idx} className="px-2 py-1.5 text-left font-bold text-slate-600 border-r border-slate-200 last:border-0">{h.trim()}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-slate-200">
            {rows.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-slate-50/50">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="px-2 py-1 text-slate-600 border-r border-slate-200 last:border-0">{renderInline(cell.trim())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    currentTable = [];
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('|')) {
      inTable = true;
      const cells = line.split('|').slice(1, -1);
      if (cells.every(c => c.trim().match(/^-+$/))) {
        // Divider row, skip
      } else {
        currentTable.push(cells);
      }
    } else {
      if (inTable) {
        flushTable(i);
      }
      
      if (line.startsWith('### ')) {
        elements.push(<h4 key={i} className="text-xs font-bold text-slate-800 mt-2 mb-1">{line.slice(4)}</h4>);
      } else if (line.startsWith('## ')) {
        elements.push(<h3 key={i} className="text-sm font-black text-slate-800 mt-2 mb-1">{line.slice(3)}</h3>);
      } else if (line.startsWith('# ')) {
        elements.push(<h2 key={i} className="text-base font-black text-slate-900 mt-3 mb-1.5">{line.slice(2)}</h2>);
      } else if (line.startsWith('* ') || line.startsWith('- ')) {
        elements.push(
          <div key={i} className="flex gap-1.5 ml-2 text-xs my-0.5">
            <span className="text-slate-400">•</span>
            <span className="text-slate-700">{renderInline(line.slice(2))}</span>
          </div>
        );
      } else if (line.trim() !== '') {
        elements.push(<p key={i} className="text-xs text-slate-700 leading-relaxed my-1">{renderInline(line)}</p>);
      }
    }
  }
  
  if (inTable) {
    flushTable(lines.length);
  }
  
  return <div className="space-y-0.5">{elements}</div>;
}
