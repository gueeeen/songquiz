// 把 web/ 用 HTTP 端出來，給 Playwright 測工作目錄裡的版本。
//
// 為什麼不直接用 file://：那個站本身設計成雙擊就能玩，所以 file:// 是跑得起來的，
// 但測試環境下有兩個問題——iframe 與 fetch 會被當成跨來源，而且 Playwright 的
// baseURL 相對路徑解析方式不一樣。測「已經發佈的版本」時改用 QA_BASE_URL 指過去。
//
// 刻意不裝 http-server 那類套件：這裡只需要「回傳檔案」，二十行就夠了，
// 而每多一個相依就多一次「哪天它壞了」。

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..', 'web');
const port = Number(process.env.QA_PORT || 4173);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
};

http.createServer((request, response) => {
  // 查詢字串要丟掉：站上的資源都帶 ?v=N。
  const asked = decodeURIComponent(request.url.split('?')[0]);
  const relative = asked === '/' ? 'index.html' : asked.replace(/^\/+/, '');
  const file = path.join(root, relative);

  // 不准跳出 web/。這支只在本機跑，但「路徑穿越」是那種寫的時候順手擋、
  // 沒擋就會在某天變成新聞的東西。
  // 要比到分隔符為止。只比 startsWith(root) 的話，隔壁一個叫 web-backup 的
  // 目錄也會通過——這支只在本機跑，但這種錯沒有「只是小事」的版本。
  if (file !== root && !file.startsWith(root + path.sep)) {
    response.writeHead(403).end('no');
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404).end('not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      // 測試要量的是「音檔有沒有被快取」，而音檔在 Apple 那邊。
      // 這裡端出去的 HTML/JS 不要被快取，否則改了程式卻測到舊的。
      'Cache-Control': 'no-store',
    });
    response.end(data);
  });
}).listen(port, () => {
  console.log(`web/ 端在 http://localhost:${port}/`);
});
