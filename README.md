# 中華電信門號快選

一個替中華電信門號查詢頁做的手機友善介面。它會代理官方 Big5 頁面，整理成比較好掃描、比較適合手機操作的門號清單，同時保留官方「即時狀態與申租限制」視窗。

正式站：[https://cht-number-picker.pages.dev](https://cht-number-picker.pages.dev)

## 功能

- 支援前四碼、不拘、後六碼、特殊號碼費、各位置不含 4。
- 後六碼查詢用 `x` 代表任意數字，例如 `58xx58`。
- 4 個 `x` 會自動拆成 10 組官方允許的查詢並合併結果；5 個以上不支援。
- 可選擇抓 1、3、5 頁官方結果，每頁 20 筆。
- 查詢結果可切換一排 1 個 / 一排 2 個顯示方式。
- 可依好記度或號碼排序，也可收藏、複製待選門號。
- 主題門號保留官方分類，不會一次把所有主題號碼混在一起。
- 每筆門號旁的放大鏡可開啟官方「號碼即時狀態與申租限制」視窗。

## 本機開發

需求：

- Node.js 20+

啟動：

```bash
npm start
```

開啟 [http://localhost:5173](http://localhost:5173)。

## 部署到 Cloudflare Pages

```bash
npm run deploy:cf
```

## 專案結構

- [public/index.html](/public/index.html)
- [public/app.js](/public/app.js)
- [public/styles.css](/public/styles.css)
- [worker.js](/worker.js)
- [server.js](/server.js)

## 注意

請避免自動大量查詢。官方頁面本身有同時查詢人數限制，這個工具只會在使用者操作時送出請求。

即時狀態視窗會沿用本次查詢的官方 session，約 30 分鐘後過期；預約與個資填寫仍是中華電信官方流程。
