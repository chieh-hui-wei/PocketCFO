# pocketCFO — 個人財務追蹤系統

自動解析電子對帳單，產生每月 **Balance Sheet（資產負債表）** 與 **Income Statement（收支表）**。

## 🚀 特色功能

| 功能 | 說明 |
|------|------|
| 📄 PDF 解析 | 上傳銀行/信用卡/證券 PDF → Gemini 自動擷取結構化資料，並自動比對完整帳號 |
| 🏦 資產負債表 | 每月現金 + 證券市值 + 信用卡負債 → 淨資產（股票代號與資產佔比圖表整合） |
| 📊 收支表 | 薪資/投資收入 vs 刷卡/提現支出，**自動排除帳戶間互轉** |
| 🔌 券商 API | 支援台新證券與玉山證券 API，永豐金證券則可進行**手動持股與餘額登錄** |
| 📅 自動排程同步 | **背景排程器**自動於每月最後一天 22:00 同步所有券商持股/資產，並重算資產負債表 |
| 📈 股票庫存管理 | 支援手動新增/編輯股票明細（代號、股數、均價、收盤價自動取得）與調整現金餘額 |
| 🔔 非阻塞式通知 | 採用 **Zustand 全域狀態**管理，以精美 non-blocking Toast 彈窗取代原生的 blocking browser `alert()` |
| 🖨️ PDF 報表 | 自動生成精美排版的企業級 PDF 財務報表 |
 
---
 
## 🔒 系統安全防護與登入設定
 
為防止他人隨意瀏覽您的財務資訊，本系統已啟用登入解鎖機制：
 
1. **認證機制**：採用安全的 JSON Web Token (JWT) 及靜態密碼解鎖機制，每次成功登入可維持 7 天解鎖狀態。
2. **修改密碼**：
   - 系統預設解鎖密碼為 `admin`。
   - 若要修改，請在根目錄的 `.env` 檔案中新增或變更 `APP_PASSWORD` 變數：
     ```env
     APP_PASSWORD=您的安全解鎖密碼
     ```
   - 密碼驗證在後端使用時序安全比較，防止旁路洩漏。
3. **JWT 簽章**：系統將自動使用 `.env` 中的 `APP_SECRET_KEY` 對登入 Token 進行安全簽章。

---

## 📈 股票與帳戶管理說明

### 🏦 帳戶管理 (Accounts)
* **帳戶管理頁面** 僅用來管理日常的 **銀行帳戶** 與 **設定內部帳戶過濾**（轉帳排除）。
* 為了簡化管理，**證券與券商帳戶**已被獨立出帳戶管理頁面，統一移至 **「股票庫存」** 頁面進行配置與新增。

### 📊 手動股票庫存 (Manual Stock Holdings)
若您使用的券商（如永豐金證券）目前沒有啟用 API 同步，或是 API 連線有問題：
1. 前往 **「股票庫存」** 頁面。
2. 點擊左下角 **「+ 新增證券帳戶」**，建立您自訂的券商名稱。
3. 選取該券商後，點選 **「編輯 / 手動登錄此月庫存」**，即可手動增加持股（輸入代號、股數、平均成本、收盤現價等）。
4. 點選 **「儲存本月股票庫存」** 後，系統將自動計算估算市值與未實現損益，並同步更新至資產負債表。

---

## 專案架構

```
pocketCFO/
├── main.py                          # FastAPI 進入點
├── pyproject.toml
├── .env.example
├── src/
│   ├── controllers/                 # FastAPI routers (HTTP 層)
│   │   ├── upload_controller.py     #   PDF 上傳與 Gemini 解析
│   │   ├── balance_sheet_controller.py
│   │   ├── income_statement_controller.py
│   │   └── account_controller.py
│   ├── instances/                   # 單例 / 配置
│   │   ├── config.py                #   Pydantic-Settings (.env)
│   │   ├── database.py              #   SQLAlchemy 連線
│   │   └── gemini.py                #   Gemini AI 用戶端
│   ├── dbs/                         # 資料層
│   │   ├── models.py                #   SQLAlchemy ORM models
│   │   └── repository.py            #   DB 存取 Repository
│   ├── services/                    # 業務邏輯
│   │   ├── statement_service.py     #   對帳單解析調度
│   │   ├── balance_sheet_service.py #   資產負債表運算
│   │   ├── income_statement_service.py # 損益表運算（含跨行轉帳過濾）
│   │   ├── scheduler.py             #   ⭐ 自動排程同步 (每月最後一天 22:00)
│   │   └── parsers/
│   │       └── bank_statement_parser.py # Gemini 銀行對帳單 Prompt 定義
│   └── utils/
│       ├── date_utils.py
│       └── transfer_detector.py     #   ⭐ 帳內互轉智慧偵測
└── frontend/                        # React + Vite + Tailwind
    └── src/
        ├── components/
        │   └── ToastContainer.tsx   #   全域 Toast 視窗元件
        ├── store/
        │   └── useToastStore.ts     #   Zustand 狀態管理 (Toast)
        ├── pages/
        │   ├── DashboardPage.tsx    #   儀表板
        │   ├── BalanceSheetPage.tsx #   資產負債表及餘額調整
        │   ├── StockHoldingsPage.tsx #  ⭐ 股票庫存與手動登錄
        │   └── UploadPage.tsx       #   對帳單上傳與解析預覽
```

---

## 快速開始

### 1. 安裝後端

```bash
cd pocketCFO
cp .env.example .env
# 填入 GEMINI_API_KEY 以及券商設定

pip install -e ".[dev]"
python main.py
# → http://localhost:8000/docs
```

### 2. 安裝前端

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### 3. 或用 Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

## 使用流程

### 每月例行作業

1. **上傳對帳單**（上傳頁面）
   - 銀行對帳單 PDF（e.g. 台新銀行存款明細）
   - 信用卡帳單 PDF（e.g. 台新 @GoGo 卡）
   - 證券對帳單 PDF（e.g. 永豐金豐存股明細）

2. **（可選）API 同步券商** → 即時拉取目前持倉

3. **計算報表**
   - 資產負債表頁面 → 選年月 → 點「計算」
   - 收支表同理

### 帳戶互轉處理

`TransferDetector` 透過以下策略自動排除帳戶間轉帳：

1. **關鍵字比對**：「跨行轉帳」「ATM轉帳」「轉入」「匯入款」等
2. **帳號比對**：`INTERNAL_ACCOUNT_IDS` 環境變數中列出自己的帳號號碼，如果交易描述中出現則標記
3. **金額配對**（進階）：`TransferDetector.pair_transfers()` — 在不同帳戶的交易中找出金額 + 日期相近的借貸配對

在 `.env` 中設定：
```
INTERNAL_ACCOUNT_IDS=["00123456789","00987654321"]
```

## 券商 API 設定

### 永豐金（豐存股）

使用 [shioaji](https://sinotrade.github.io/) Python SDK：

```bash
pip install shioaji
```

從永豐金網站申請 API Key 並下載憑證（.pfx），上傳至憑證管理頁面。

### 台新證券

使用 REST API + mTLS 客戶端憑證：

1. 至台新證券官網申請 API 存取
2. 下載 .pfx 憑證
3. 在 pocketCFO 上傳憑證頁面上傳

## 資料模型

```
Account (帳戶)
  └── AccountSnapshot (每月餘額快照)
  └── Security (持股)
  └── Transaction (交易記錄)
  └── CreditCardBill (信用卡帳單)
        └── CreditCardItem (帳單明細)

BalanceSheet (計算結果)
IncomeStatement (計算結果)
```

## API 文件

啟動後端後訪問 http://localhost:8000/docs
