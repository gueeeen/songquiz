// 網路限速。三個地方要用（測試、diag、warmcost），所以只寫一份。
//
// 限速走 Chrome DevTools Protocol，WebKit 沒有——所以用到它的測試都只在
// Chromium 上跑。

/**
 * 幾種網速。`down`／`up` 是 bit/s。
 *
 * 上傳一律設成下載的一半：一般家用和行動網路都是這個量級，而這個站幾乎不上傳
 * （只有排行榜和意見箱各一次 POST），所以它對測出來的數字沒有影響。
 * 寫明是因為抽出共用版本的時候差點把它從 1 Mbps 悄悄變成 2 Mbps——
 * 那四條量時間的斷言是照 booth 這一組校準的。
 */
const PROFILES = {
  wifi:   { name: '好的 Wi-Fi  10 Mbps', down: 10 * 1024 * 1024, latency: 40 },
  lte:    { name: '普通 4G      4 Mbps', down: 4 * 1024 * 1024, latency: 100 },
  booth:  { name: '攤位 Wi-Fi   2 Mbps', down: 2 * 1024 * 1024, latency: 300 },
  slow:   { name: '很慢         1 Mbps', down: 1 * 1024 * 1024, latency: 300 },
  slow3g: { name: '慢速 3G    400 Kbps', down: 400 * 1024, latency: 400 },
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
  if (!profile) throw new Error('沒有這一種網速：' + key + '（有的是 ' + Object.keys(PROFILES).join('、') + '）');

  const cdp = await page.context().newCDPSession(page);

  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latency,
    downloadThroughput: profile.down / 8,
    uploadThroughput: profile.down / 16,
  });

  return cdp;
}

module.exports = { PROFILES, throttle };
