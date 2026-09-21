// 網路限速。三個地方要用（測試、diag、warmcost），所以只寫一份。
//
// 限速走 Chrome DevTools Protocol，WebKit 沒有——所以用到它的測試都只在
// Chromium 上跑。

/** 幾種網速。數字是 bit/s。 */
const PROFILES = {
  wifi:   { name: '好的 Wi-Fi  10 Mbps', bps: 10 * 1024 * 1024, latency: 40 },
  lte:    { name: '普通 4G      4 Mbps', bps: 4 * 1024 * 1024, latency: 100 },
  booth:  { name: '攤位 Wi-Fi   2 Mbps', bps: 2 * 1024 * 1024, latency: 300 },
  slow:   { name: '很慢         1 Mbps', bps: 1 * 1024 * 1024, latency: 300 },
  slow3g: { name: '慢速 3G    400 Kbps', bps: 400 * 1024, latency: 400 },
};

/**
 * 把這一頁的頻寬壓到指定的等級。
 *
 * 預設是 booth（2 Mbps）：這台機器連 Apple 太快（冷啟動只要一兩百毫秒），
 * 量不到使用者遇到的狀況。2 Mbps 下一首 1 MB 的試聽要抓四秒多，超過 app.js
 * 那個三秒守門計時器——沒有預載的話每一題都會卡。
 */
async function throttle(page, key = 'booth') {
  const profile = PROFILES[key];
  const cdp = await page.context().newCDPSession(page);

  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latency,
    downloadThroughput: profile.bps / 8,
    uploadThroughput: profile.bps / 8,
  });

  return cdp;
}

module.exports = { PROFILES, throttle };
