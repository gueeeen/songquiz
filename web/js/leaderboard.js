// 排行榜。兩份榜同時存在，因為它們回答的是兩個不同的問題：
//
//   本機榜：「我自己有沒有進步？」——存在這台裝置的 localStorage，離線也在。
//   線上榜：「跟別人比呢？」——存在 Supabase，所有人同一份。
//
// 兩份都按「模式＋題數＋語種」分開排。5 題的積分和 20 題的闖關不是同一件事，
// 混在一起排名沒有意義。
//
// 誠實話：分數是玩家的瀏覽器算出來再送上去的，改 JavaScript 就能送一個假分數。
// 要真的防作弊，判分必須搬回伺服器（見 架構.md 第三節）。
// 這個榜是給朋友之間玩的，不是競賽計分系統。

(function () {
  'use strict';

  /** 本機榜每一組設定留幾筆。留太多沒人看，留太少看不出進步。 */
  var LOCAL_KEEP = 10;

  /** 線上榜一次抓幾筆。 */
  var ONLINE_TOP = 10;

  var config = window.REALTIME_CONFIG || {};

  /**
   * 線上榜借用多人房間那組 Supabase 設定——同一個專案、同一把公開金鑰。
   * 沒設定就只有本機榜，遊戲其他部分完全不受影響。
   */
  function online() {
    return config.provider === 'supabase' && config.url && config.anonKey;
  }

  /** 一組設定的識別字串。兩份榜共用同一個定義，才不會各排各的。 */
  function keyOf(entry) {
    return [entry.mode, entry.questionCount, entry.languages.join('-')].join('.');
  }

  // ---- 本機榜 ----

  function localKey(entry) {
    return 'songquiz.board.' + keyOf(entry);
  }

  function readLocal(entry) {
    try {
      var raw = localStorage.getItem(localKey(entry));
      var rows = raw ? JSON.parse(raw) : [];
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      // 壞掉的資料就當沒有。為了一份排行榜讓整個結算頁掛掉不值得。
      return [];
    }
  }

  function writeLocal(entry, rows) {
    try {
      localStorage.setItem(localKey(entry), JSON.stringify(rows));
    } catch (e) {
      // 記不住就算了
    }
  }

  /**
   * 把這一局記進本機榜，回傳這一局在榜上的名次（1-based）與整份榜。
   * 名次是「這一局排第幾」，不是「最好的那一局排第幾」——玩家想知道的是前者。
   */
  function addLocal(entry) {
    var rows = readLocal(entry);

    rows.push({
      score: entry.score,
      stage: entry.stage,
      correct: entry.correct,
      total: entry.total,
      at: new Date().toISOString().slice(0, 10),
    });

    rows.sort(function (a, b) {
      return b.score - a.score;
    });

    // 先算名次再砍長度：被擠出榜外的那一局也該知道自己是第幾名。
    var rank = rows.indexOf(rows.filter(function (row) {
      return row.score === entry.score;
    })[0]) + 1;

    writeLocal(entry, rows.slice(0, LOCAL_KEEP));

    return { rank: rank, rows: rows.slice(0, LOCAL_KEEP), total: rows.length };
  }

  // ---- 線上榜 ----
  // 直接打 Supabase 的 REST（PostgREST），不載 SDK：一次 insert、一次 select，
  // 為了這兩個請求去載 218 KB 的 SDK 不值得。

  function rest(path, options) {
    options = options || {};

    return window.fetch(config.url + '/rest/v1/' + path, {
      method: options.method || 'GET',
      headers: {
        apikey: config.anonKey,
        Authorization: 'Bearer ' + config.anonKey,
        'Content-Type': 'application/json',
        Prefer: options.prefer || '',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          throw new Error('HTTP ' + response.status + '：' + text.slice(0, 120));
        });
      }

      // 寫入用 Prefer: return=minimal，伺服器回 204 沒有內容——
      // 這時候去 response.json() 會丟「Unexpected end of JSON input」，
      // 看起來就像上榜失敗，其實資料早就寫進去了。
      if (response.status === 204) return null;

      return response.text().then(function (text) {
        return text ? JSON.parse(text) : null;
      });
    });
  }

  function filterFor(entry) {
    return 'mode=eq.' + encodeURIComponent(entry.mode) +
      '&question_count=eq.' + entry.questionCount +
      '&languages=eq.' + encodeURIComponent(entry.languages.join('-'));
  }

  /** 送出一筆成績。回傳 Promise，失敗會 reject，呼叫端自己決定要不要講。 */
  function submit(entry, nickname) {
    if (!online()) return Promise.reject(new Error('線上榜沒有設定'));

    return rest('scores', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        nickname: String(nickname || '').slice(0, 12) || '無名',
        mode: entry.mode,
        question_count: entry.questionCount,
        languages: entry.languages.join('-'),
        score: entry.score,
        stage: entry.stage || null,
        correct: entry.correct,
        total: entry.total,
      },
    });
  }

  /** 抓這一組設定的前幾名。 */
  function top(entry) {
    if (!online()) return Promise.reject(new Error('線上榜沒有設定'));

    return rest('scores?select=nickname,score,stage,correct,total,created_at&' +
      filterFor(entry) + '&order=score.desc&limit=' + ONLINE_TOP);
  }

  window.Leaderboard = {
    available: online,
    addLocal: addLocal,
    readLocal: readLocal,
    submit: submit,
    top: top,
  };
})();
