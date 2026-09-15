// 意見箱：把星等和文字送到 Supabase 的 feedback 表。
//
// 只寫、不讀。那張表的 RLS 沒有 select 政策（見 tools/supabase-意見箱.sql），
// 所以這個檔裡不會有任何「把意見撈回來」的函式——寫得出去、讀不回來是刻意的，
// 否則任何人都能把所有人的意見整批抓走。
//
// 這裡不碰 DOM。畫面在 feedbackui.js。

(function () {
  'use strict';

  var config = window.REALTIME_CONFIG || {};

  /** 和排行榜借用同一組 Supabase 設定——同一個專案、同一把公開金鑰。 */
  function available() {
    return config.provider === 'supabase' && !!config.url && !!config.anonKey;
  }

  /**
   * 環境資訊。出問題的時候要知道是什麼裝置，
   * 但只留瀏覽器自己就會送出去的那一行，不加任何可以認出個人的東西。
   */
  function device() {
    var parts = [];
    if (window.navigator && window.navigator.userAgent) {
      parts.push(window.navigator.userAgent.slice(0, 160));
    }
    parts.push(window.innerWidth + 'x' + window.innerHeight);
    return parts.join(' | ').slice(0, 200);
  }

  /** 空字串一律當成「沒填」送 null：資料庫那邊的 check 允許 null，不允許亂碼。 */
  function textOrNull(value, limit) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return null;
    return text.slice(0, limit);
  }

  /**
   * 1～5 以外一律當成沒填。
   *
   * 「沒回答」和「給 3 分」不是同一件事：星星點同一顆可以取消回到 0，
   * 那時候這筆根本不該送出（送出鈕會是停用的）。
   */
  function scoreOrNull(value) {
    var score = Number(value);
    if (!score || score < 1 || score > 5) return null;
    return Math.round(score);
  }

  /**
   * 送出一筆意見。
   *
   * @param {object} input stars 必填（1～5），其餘都可以不填
   * @returns {Promise}
   */
  function send(input) {
    if (!available()) {
      return Promise.reject(new Error('意見箱還沒設定（realtime-config.js 沒有填 Supabase）'));
    }

    var stars = scoreOrNull(input && input.stars);
    if (!stars) return Promise.reject(new Error('請先給幾顆星'));

    var row = {
      stars: stars,
      note: textOrNull(input.note, 500),
      device: device(),
    };

    return window.fetch(config.url + '/rest/v1/feedback', {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: 'Bearer ' + config.anonKey,
        'Content-Type': 'application/json',
        // 不要回傳內容：那張表不給讀，要了也拿不到，只會多一次失敗。
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    }).then(function (response) {
      if (response.ok) return null;

      return response.text().then(function (text) {
        // 表還沒建的時候 PostgREST 回的是這一句，直接講清楚怎麼修，
        // 不要讓人對著「HTTP 404」猜。
        if (response.status === 404 || text.indexOf('feedback') !== -1 && text.indexOf('does not exist') !== -1) {
          throw new Error('資料表還沒建——把 tools/supabase-意見箱.sql 貼到 Supabase 的 SQL Editor 跑一次。');
        }
        throw new Error('HTTP ' + response.status + '：' + text.slice(0, 120));
      });
    });
  }

  window.Feedback = {
    available: available,
    send: send,
  };
})();
