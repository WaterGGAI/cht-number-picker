# Contributing

感謝你想一起改善這個專案。

這個工具的定位很簡單：把中華電信原本偏桌機、偏舊式的門號查詢流程整理成更適合手機與快速操作的介面，但不取代官方預約與即時狀態流程。

## 開發環境

需求：

- Node.js 20+

安裝依賴：

```bash
npm install
```

啟動本機：

```bash
npm start
```

開啟 [http://localhost:5173](http://localhost:5173)。

## 主要檔案

- `public/index.html`: 介面結構
- `public/app.js`: 前端查詢流程、狀態管理、分類與清單邏輯
- `public/app-logic.js`: 前端共用的純排序 / 分頁 / pattern / snapshot helper
- `public/styles.css`: 視覺與響應式樣式
- `lib/cht-core.cjs`: Worker / server 共用的查詢、解析與 rewrite 核心
- `scripts/prepare-pages.mjs`: 產生 Pages 用 `_worker.js` wrapper
- `worker.js`: Cloudflare Pages / Worker 代理邏輯
- `server.js`: 本機開發用代理伺服器

## 提交前建議檢查

至少跑一次：

```bash
npm test
npm run check:cf
```

GitHub Actions 也會跑同一組檢查，所以本機先過一遍通常最省時間。

如果你只是想快速確認本機 server 有正常啟動，也可以另外打：

```bash
curl http://localhost:5173/api/health
```

如果有改 UI，請自己確認：

- 手機版首屏沒有擠壓
- 文字不會溢出按鈕或卡片
- 主題門號分類仍正常
- 門號即時查視窗仍能打開

## 開發原則

### 1. 保留官方流程

這個專案是「重新整理查詢體驗」，不是重建中華電信整套流程。

- 官方即時狀態頁、預約、申租限制仍以官方頁面為準
- 不要把需要官方確認的流程做成本地假動作

### 2. 尊重官方站負載

請避免把查詢邏輯改成大量自動輪詢或高頻抓取。

- 單次查詢以使用者操作觸發為主
- wildcard 拆查要保守處理
- 不要加入背景自動重刷或批量暴力查詢

### 3. 先顧手機體驗

這個專案最核心的價值就是手機好用，所以 UI 調整優先考慮：

- 首屏資訊密度
- 點擊區大小
- 查詢條件輸入便利性
- 結果掃描效率

### 4. 優先沿用現有模式

除非真的有必要，否則盡量延續目前專案已經存在的做法：

- 原生 HTML / CSS / JS
- `lib/cht-core.cjs` 優先維持為 Worker / server 共用邏輯
- 前端與 Worker 分離
- 本機 `server.js` 與雲端 `worker.js` 行為盡量一致

## Pull Request 建議

PR 說明至少包含：

- 改了什麼
- 為什麼改
- 影響哪個流程
- 怎麼驗證

如果改的是 UI，附上桌面版或手機版截圖會很有幫助。
