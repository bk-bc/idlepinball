# Neon Idle Pinball MVP

網頁版放置型彈珠台 MVP，使用 HTML、CSS、JavaScript 與 Canvas 2D 製作，不依賴大型框架。

## 執行方式

直接用瀏覽器開啟 `index.html` 即可遊玩。

如果瀏覽器限制本機檔案功能，也可以在專案資料夾啟動任一靜態伺服器後開啟，例如：

```bash
python -m http.server 8000
```

然後前往 `http://localhost:8000`。

## 內容

- 玩家擁有 Energy 作為主要資源。
- 場上一次最多只有一顆球。
- 球會自動畫面上方落下，碰撞固定釘子後進入底部 5 個功能型得分槽。
- 得分槽為 Stable、Boost、Core、Speed、Charge，各自有不同 Energy 倍率與 Bonus Gauge 增量。
- 結算後依照基礎收益、得分槽倍率、總收益倍率與 Bonus Ready 狀態增加 Energy，並等待下一次落球。
- Bonus Gauge 滿 100 後，下一顆球結算收益 x5，觸發後歸零。
- Machine Level 依 totalEarnedEnergy 解鎖，只提供視覺強化。

## 升級

- Energy Value：提高基礎收益。
- Drop Speed：依等級調整落球間隔，Lv.6 為結算後無延遲生成下一顆球。
- Bounce Power：提高反彈力。
- Score Multiplier：提高總收益倍率。

## 存檔與離線收益

遊戲使用 `localStorage` 儲存：

- Energy
- 升級等級
- 上次離開時間
- totalEarnedEnergy
- Machine Level
- Bonus Gauge
- Bonus Ready
- 音效開關狀態

重新整理或再次打開頁面時會讀取存檔，並用簡化在線收益估算離線收益。離線收益比例為在線估算收益的 30%，會增加 Energy 與 totalEarnedEnergy，但不會增加 Bonus Gauge。

## 效能限制

- 不使用粒子系統，只保留少量得分文字與短球體殘影。
- 一次只存在一顆球。
- Canvas 依照裝置像素比縮放，上限為 2，避免手機過度繪製。
