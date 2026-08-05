# AI 助理工具與函式說明

本文件說明 `src/services/ai_assistant/` 與 `src/controllers/ai_assistant/` 中的所有函式，
包含 Gemini 可呼叫的 tool（工具）定義、服務層邏輯，以及對外的 API 端點。

---

## 架構總覽

```
controllers/ai_assistant/
├── api.py     # FastAPI 路由（/ai/chat, /ai/chat/confirm-action, /ai/sql-query）
└── model.py   # Pydantic 請求/回應 schema

services/ai_assistant/
├── service.py # 對話流程調度、SQL 安全驗證、串流回應
└── tools.py   # Gemini 可呼叫的工具（讀取 / 寫入）註冊表
```

流程：使用者訊息 → `AIAssistantService.process_chat_stream` 先讓 Gemini 決定是否呼叫工具
（讀取財務資料或執行寫入動作）→ 需要使用者確認的動作會先回傳 `pending_action` 事件 →
使用者確認後由 `/ai/chat/confirm-action` 執行 → 最終由 Gemini 串流生成回覆文字。

---

## `src/controllers/ai_assistant/model.py`

Pydantic schema，定義 API 的請求/回應格式。

| 名稱 | 說明 |
|------|------|
| `ChatMessage` | 單則對話訊息，包含 `role`（`user`/`model`）與 `content`。 |
| `ChatRequest` | `/ai/chat` 的請求體：`message`（本次訊息）、`history`（對話歷史）、`model`（可選，指定 Gemini 模型）。 |
| `ConfirmActionRequest` | `/ai/chat/confirm-action` 的請求體：`action`（工具名稱）、`args`（工具參數）、`model`（可選）。 |
| `SQLRequest` | `/ai/sql-query` 的請求體：`query`（SQL 查詢字串）。 |

---

## `src/controllers/ai_assistant/api.py`

對外的 FastAPI 路由，皆需通過 `verify_token` 驗證使用者身分。

| 端點 | 函式 | 說明 |
|------|------|------|
| `POST /ai/chat` | `chat_assistant` | 聊天機器人主入口。呼叫 `AIAssistantService.process_chat_stream` 並以 SSE（`text/event-stream`）串流回傳。失敗時回傳 500。 |
| `POST /ai/chat/confirm-action` | `confirm_chat_action` | 執行先前被標記為 `pending_action` 的寫入動作（例如建立到價提醒）。呼叫 `AIAssistantService.confirm_action`。失敗時回傳 400。 |
| `POST /ai/sql-query` | `execute_sql_query` | 開發者模式 SQL 控制台，只允許唯讀查詢。呼叫 `AIAssistantService.execute_raw_sql`。驗證失敗回傳 400。 |

---

## `src/services/ai_assistant/service.py`

### `validate_safe_sql(query, require_user_id=True)`
驗證開發者 SQL 控制台輸入的查詢字串是否安全：
- 僅允許 `SELECT` 或 `WITH` 開頭的查詢。
- 禁止 `insert`/`update`/`delete`/`drop`/`alter`/`truncate`/`grant`/`revoke`/`create`/`replace` 等會修改資料的關鍵字。
- 禁止存取敏感資料表（`users`、`user_invitations`）。
- 若 `require_user_id=True`，查詢中必須包含 `:user_id` 參數以確保租戶資料隔離。
- 驗證失敗時拋出 `ValueError`。

### `AIAssistantService.process_chat_stream(request, user_id, db, current_user)`
主要的聊天流程，回傳一個 async generator（SSE 事件字串）：
1. 將對話歷史轉為 Gemini `Content` 物件。
2. **Tool-use 階段**：呼叫 Gemini（`temperature=0.0`），提供 `FUNCTION_DECLARATIONS` 讓其判斷是否需要呼叫讀取或寫入工具。
   - 若工具屬於 `CONFIRMATION_REQUIRED`（例如 `create_price_alert`），不會直接執行，而是送出 `pending_action` 事件後直接結束串流，等待使用者於前端確認。
   - 其餘工具會立即透過 `execute_tool_call` 執行，結果以「System context」文字附加到後續的 prompt。
   - 若工具呼叫失敗，僅記錄錯誤並附加一則「無法完成」的系統提示，不會將內部錯誤訊息洩漏給使用者。
3. **回覆生成階段**：將工具執行結果與使用者原始問題組成最終 prompt，以 `temperature=0.7` 呼叫 Gemini 並串流輸出文字（`data: {...}\n\n` SSE 格式），結尾送出 `data: [DONE]\n\n`。

### `AIAssistantService.confirm_action(action, args, user_id, current_user, db)`
在使用者於前端確認 `pending_action` 後呼叫，透過 `execute_tool_call` 實際執行該工具（例如送出到價自動下單），回傳 `{"action": ..., "result": ...}`。

### `AIAssistantService.execute_raw_sql(query, user_id, db)`
開發者 SQL 控制台使用。先以 `validate_safe_sql` 驗證查詢安全性，再以 `:user_id` 綁定參數執行查詢，回傳欄位名稱與資料列（皆轉為字串以利前端顯示）。

---

## `src/services/ai_assistant/tools.py`

定義 Gemini function-calling 用的工具註冊機制，以及所有讀取/寫入工具的實作。

### 核心機制

| 名稱 | 說明 |
|------|------|
| `ToolSpec` | dataclass，描述一個工具：`name`、`description`（取自函式 docstring，會提供給 LLM 判斷何時呼叫）、`parameters`（JSON Schema）、`confirmation_required`（是否需要使用者確認才能執行）、`func`（實際執行的 async 函式）。 |
| `tool(*, parameters, confirmation_required=False)` | 裝飾器，將一個 async 函式註冊為 Gemini 可呼叫的工具。所有被註冊的函式都必須接受 `(args, user_id, current_user, db)` 並回傳可 JSON 序列化的 dict。 |
| `execute_tool_call(name, args, user_id, current_user, db)` | 依名稱從註冊表 `_REGISTRY` 查找並執行對應工具；找不到時拋出 `ValueError`。 |
| `FUNCTION_DECLARATIONS` | 由註冊表衍生出的 `google.genai.types.FunctionDeclaration` 清單，提供給 Gemini 作為可用工具列表。 |
| `CONFIRMATION_REQUIRED` | 需要使用者確認才能執行的工具名稱集合（目前僅 `create_price_alert`）。 |

### 內部輔助函式

| 名稱 | 說明 |
|------|------|
| `_parse_period(period)` | 將 `"YYYY-MM"` 字串轉換為當月第一天的 `date` 物件；輸入為空則回傳 `None`。 |
| `_serialize_account(a)` | 將 `Account` ORM 物件序列化為 dict（id、名稱、代碼、類型、機構、幣別、是否為內部帳戶）。 |
| `_serialize_snapshot(s)` | 序列化帳戶月結餘額快照（帳戶 id、期間、餘額、幣別、應繳日）。 |
| `_serialize_transaction(t)` | 序列化交易紀錄（id、日期、帳戶、商家、描述、金額、幣別、類別、是否為內部轉帳）。 |
| `_serialize_security(s)` | 序列化證券庫存（帳戶、期間、代號、名稱、股數、成本、現價、市值、未實現損益、幣別）。 |
| `_serialize_balance_sheet(bs)` | 序列化資產負債表（期間、總現金、證券市值、總資產、信用卡應付、總負債、淨資產）。 |
| `_serialize_income_statement(inc)` | 序列化損益表（期間、總收入、薪資/投資/其他收入、總支出、信用卡/銀行支出、淨儲蓄）。 |
| `_serialize_price_alert(pa)` | 序列化到價提醒（id、代號、名稱、方向、目標價、股數、券商、狀態）。 |

### 讀取工具（Read tools）

| 工具名稱 | 說明 | 參數 |
|---|---|---|
| `get_accounts` | 列出使用者名下所有帳戶（銀行、信用卡、證券、負債等），含基本資料但不含餘額。查詢餘額/交易/庫存前通常需先呼叫此工具取得 `account_id`。 | 無 |
| `get_account_balances` | 查詢每個帳戶在指定月份（或最新一筆）的現金餘額快照。 | `period`（可選，`YYYY-MM`） |
| `get_transactions` | 查詢指定日期區間內的交易明細，可依類別或帳戶篩選；最多回傳 200 筆，依日期新到舊排序。 | `start_date`、`end_date`（必填）、`category`、`account_id`（可選） |
| `get_securities` | 查詢「個股層級」股票／證券庫存明細（含股數、成本、現價、市值、未實現損益）。不含配置比例，「資產配置」問題請改用 `get_asset_allocation`。 | `period`（可選） |
| `get_balance_sheet` | 查詢指定月份（或最新一期）已計算好的資產負債表總覽。**不含**資產配置目標比例，「資產配置」問題請改用 `get_asset_allocation`。 | `period`（可選） |
| `get_asset_allocation` | 查詢「資產配置」實際比例 vs. 目標比例（來自再平衡策略設定），含股票/債券/現金實際與目標百分比、是否觸發再平衡、每檔證券的配置明細。委派給 `services.rebalance.service.RebalanceService.analyze_rebalance`。 | `period`（可選） |
| `get_income_statement` | 查詢指定月份（或最新一期）已計算好的損益表總覽。 | `period`（可選） |
| `get_price_alerts` | 列出監控中的到價提醒／到價自動下單設定；預設不含已取消的提醒。 | `include_cancelled`（可選，布林值） |

### 寫入工具（Write tools）

| 工具名稱 | 說明 | 參數 | 需要確認？ |
|---|---|---|---|
| `create_transaction` | 新增一筆交易紀錄（收入或支出）。委派給 `controllers.transactions.api.create_transaction`。 | `date`、`description`、`amount`、`category`（必填）、`merchant`、`account_id`（可選） | 否 |
| `update_transaction` | 更新既有交易紀錄的欄位。委派給 `controllers.transactions.api.update_transaction`。 | `txn_id`（必填），其餘欄位皆可選 | 否 |
| `delete_transaction` | 刪除一筆交易紀錄。委派給 `controllers.transactions.api.delete_transaction`。 | `txn_id`（必填） | 否 |
| `bulk_delete_transactions` | 批次刪除多筆交易紀錄。委派給 `controllers.transactions.api.bulk_delete_transactions`。 | `ids`（必填，整數陣列） | 否 |
| `create_price_alert` | 建立到價自動下單監控，會透過券商 API 送出限價委託單。 | `ticker`、`side`（`buy`/`sell`）、`target_price`、`quantity`（必填）、`broker`（`esun`/`taishin`）、`name`（可選） | **是** — 呼叫前必須先於對話中與使用者確認股票代號、方向、目標價、股數、券商是否正確 |
| `cancel_price_alert` | 取消一筆監控中的到價提醒或到價自動下單。委派給 `controllers.price_alerts.api.cancel_price_alert`。 | `alert_id`（必填） | 否 |

> 需要確認的工具（`confirmation_required=True`）不會在 tool-use 階段被立即執行；`process_chat_stream`
> 會改為送出 `pending_action` SSE 事件給前端，實際執行需等待使用者呼叫 `/ai/chat/confirm-action`。
