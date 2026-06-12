# pocketCFO — 個人財務追蹤系統

自動解析電子對帳單，產生每月 **Balance Sheet（資產負債表）** 與 **Income Statement（收支表）**。

## 功能

| 功能 | 說明 |
|------|------|
| 📄 PDF 解析 | 上傳銀行/信用卡/證券 PDF → Gemini 自動擷取結構化資料 |
| 🏦 資產負債表 | 每月現金 + 證券市值 + 信用卡負債 → 淨資產 |
| 📊 收支表 | 薪資/投資收入 vs 刷卡/提現支出，**自動排除帳戶間互轉** |
| 🔌 券商 API | 永豐金（shioaji SDK）、台新證券（REST mTLS）直接拉取持倉 |
| 🔐 憑證管理 | .pfx / .p12 憑證上傳 |
| 🖨️ PDF 報表 | 自動生成精美排版的企業級 PDF 財務報表 |

## 資料庫表結構 (Database Schema)

系統底層將各項金融數據標準化，總共有 8 張核心表。
**💡 特別注意**：為了減少資料表重複性，系統並沒有獨立的 `brokers` 表，而是將**「銀行」與「券商」統一整合**在 `accounts` 表中！

1. **`accounts` (銀行/券商帳戶表)**：代表銀行或券商。如果 `account_type = brokerage`，它就是一個 Broker（券商）。
2. **`account_snapshots` (帳戶現金快照表)**：紀錄銀行/券商在每個月底的「現金餘額」。這同時也作為 Broker Snapshots（券商現金快照）的儲存地。
3. **`credit_cards` (信用卡表)**：代表每一張信用卡（例如：台新 @GoGo 卡）。
4. **`credit_card_snapshots` (信用卡快照表)**：紀錄信用卡在每個月底的「應繳總額」。這是資產負債表裡「負債」的來源。
5. **`securities` (持股快照表)**：紀錄券商帳戶在每個月底的「股票持有部位」（包含股數、成本、市值、未實現損益）。這是資產負債表裡「證券投資」的來源。
6. **`transactions` (交易明細表)**：紀錄所有的單筆金流（銀行存款/提款明細、信用卡每筆消費明細）。這是收支表裡「收入與支出」的來源。
7. **`balance_sheets` (資產負債表)**：每月結算後的總覽快照（總資產、總負債、淨資產）。
8. **`income_statements` (收支表)**：每月結算後的總覽快照（總收入、總支出、淨收入）。

## 專案架構

```
pocketCFO/
├── main.py                          # FastAPI entry point
├── pyproject.toml
├── .env.example
├── src/
│   ├── controllers/                 # FastAPI routers (HTTP 層)
│   │   ├── upload_controller.py     #   POST /upload/statement, /upload/certificate
│   │   ├── balance_sheet_controller.py
│   │   ├── income_statement_controller.py
│   │   └── account_controller.py
│   ├── middleware/                  # 橫切關注點
│   │   ├── logging_middleware.py    #   structlog 請求日誌
│   │   └── error_middleware.py      #   全域例外處理
│   ├── instances/                   # 單例 / 配置
│   │   ├── config.py                #   pydantic-settings (.env)
│   │   ├── database.py              #   SQLAlchemy async engine
│   │   └── gemini.py                #   Gemini AI client
│   ├── dbs/                         # 資料層
│   │   ├── models.py                #   SQLAlchemy ORM models
│   │   └── repository.py            #   所有 DB 查詢
│   ├── services/                    # 業務邏輯
│   │   ├── statement_service.py     #   PDF 解析 → DB 儲存（orchestration）
│   │   ├── balance_sheet_service.py #   資產負債表計算
│   │   ├── income_statement_service.py # 收支表計算（含轉帳過濾）
│   │   ├── parsers/
│   │   │   └── bank_statement_parser.py # Gemini prompts for each statement type
│   │   └── brokers/
│   │       ├── sinopac_client.py    #   永豐金 shioaji SDK wrapper
│   │       └── taishin_client.py    #   台新證券 REST + mTLS
│   └── utils/
│       ├── date_utils.py
│       └── transfer_detector.py     #   ⭐ 帳戶互轉偵測邏輯
└── frontend/                        # React + Vite + Tailwind
    └── src/
        ├── pages/
        │   ├── DashboardPage.tsx    #   總覽圖表
        │   ├── BalanceSheetPage.tsx #   資產負債表
        │   └── UploadPage.tsx       #   PDF / 憑證上傳
        └── services/
            └── api.ts               #   Axios API client
```

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
