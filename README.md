# 公車時刻表 LINE Bot 🚌

每天晚上 **19:00**（台北時間）自動查詢隔天「**新坡 → 天祥醫院**」公車時刻表，透過 **LINE Bot** 推播到你的 LINE。

---

## 前置準備

### 1. 申請 TDX API 金鑰

1. 前往 [https://tdx.transportdata.tw/register](https://tdx.transportdata.tw/register) 註冊帳號
2. 登入後進入「**會員中心 → 金鑰管理**」
3. 複製 **Client ID** 與 **Client Secret**

### 2. 建立 LINE Bot

1. 前往 [https://developers.line.biz/](https://developers.line.biz/) 並登入
2. 建立 **Provider**（若沒有）→ 點選「Create a new channel」→ 選 **Messaging API**
3. 填寫 Channel 基本資料後建立
4. 進入 Channel 設定頁 → **Messaging API** 頁籤：
   - 點「**Issue**」產生 **Channel access token（long-lived）**
   - 複製下方的 **Your user ID**（這是你的 LINE User ID，用於推播目標）

---

## 本機開發

### 安裝依賴

```bash
npm install
```

### 設定環境變數

```bash
cp .env.example .env
```

編輯 `.env`，填入以下欄位：

```env
TDX_CLIENT_ID=your_tdx_client_id
TDX_CLIENT_SECRET=your_tdx_client_secret
LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token
LINE_USER_ID=your_line_user_id

# 市區公車請填縣市（二擇一）
BUS_CITY=Taoyuan          # 桃園市範例
# BUS_OPERATOR=KLBus      # 公路客運業者代碼

BUS_FROM_STOP=新坡
BUS_TO_STOP=天祥醫院
TIMEZONE=Asia/Taipei
```

> **BUS_CITY 縣市代碼對照：**
> Taipei / NewTaipei / Taoyuan / Taichung / Tainan / Kaohsiung / Keelung / Hsinchu / HsinchuCounty / ...
>
> 若為跨縣市**公路客運**，請留空 `BUS_CITY` 並填入 `BUS_OPERATOR`（業者代碼可在 TDX 文件查詢）。

### 立即測試（不等排程）

```bash
RUN_ON_START=true npm run dev
```

---

## 部署到 Railway

### 步驟

1. 將此專案推送到 **GitHub**：

   ```bash
   git init
   git add .
   git commit -m "feat: bus schedule LINE bot"
   git remote add origin https://github.com/YOUR_USERNAME/bus-schedule-bot.git
   git push -u origin main
   ```

2. 前往 [https://railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. 選擇此 repository
4. 點選專案 → **Variables** 頁籤，新增以下環境變數（**不要上傳 .env 檔**）：

   | 變數名稱 | 說明 |
   |----------|------|
   | `TDX_CLIENT_ID` | TDX Client ID |
   | `TDX_CLIENT_SECRET` | TDX Client Secret |
   | `LINE_CHANNEL_ACCESS_TOKEN` | LINE Bot Access Token |
   | `LINE_USER_ID` | 你的 LINE User ID |
   | `BUS_CITY` | 縣市代碼（或留空改填 BUS_OPERATOR）|
   | `BUS_OPERATOR` | 公路客運業者代碼（或留空改填 BUS_CITY）|
   | `BUS_FROM_STOP` | `新坡` |
   | `BUS_TO_STOP` | `天祥醫院` |
   | `TIMEZONE` | `Asia/Taipei` |

5. Railway 會自動執行 `npm run build` 並以 `npm start` 啟動服務
6. 部署完成後，查看 **Logs** 確認「公車時刻 LINE Bot 啟動中...」字樣

### 驗證排程有在執行

在 Railway Variables 頁籤加入 `RUN_ON_START=true`，重新部署後 LINE 應立即收到訊息，確認無誤後**移除此變數**（恢復只在 19:00 執行）。

---

## 資安注意事項

- `.env` 已在 `.gitignore` 中，**永遠不要** commit 到版控
- 所有 API 金鑰請透過 Railway Variables 設定，勿寫死在程式碼中
- 程式啟動時會驗證所有必要的環境變數，若有缺漏會立即報錯並中止
