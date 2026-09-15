// 排行榜的資料層。兩個來源、一組共用的篩選條件。
//
//   這台裝置：localStorage。打完一局自動記，離線也在，不會送出去給任何人。
//   線上：Supabase。**只有按下「上傳到線上榜」才會送**，因為那個暱稱別人會看到。
//
// 這兩件事刻意分得很開：本機是自動的（自己跟自己比，不需要誰同意），
// 線上是一個明確的動作。同一顆按鈕不該同時做這兩件事。
//
// 誠實話：分數是玩家的瀏覽器算出來再送上來的，改 JavaScript 就能送一個假分數。
// 要真的防作弊，判分必須搬回伺服器（見 架構.md 第三節）。
// 這個榜是給朋友之間玩的，不是競賽計分系統。

(function () {
  'use strict';

  /** 本機每一組設定留幾局。留太多沒人看，留太少看不出進步。 */
  var LOCAL_KEEP = 10;

  /** 榜上顯示幾列。 */
  var TOP = 10;

  /** 「不分題數」的榜，一次從伺服器掃幾列回來自己重排。 */
  var SCAN = 300;

  var config = window.REALTIME_CONFIG || {};

  /** 線上榜借用多人房間那組 Supabase 設定——同一個專案、同一把公開金鑰。 */
  function online() {
    return config.provider === 'supabase' && config.url && config.anonKey;
  }

  /**
   * 每題平均分。
   *
   * 「不分題數」的榜必須用它排，不能用總分：20 題的總分天生是 5 題的四倍，
   * 照總分排的話前十名永遠是 20 題場，玩 5 題的人一輩子上不了榜。
   */
  function perQuestion(row) {
    return row.score / (row.total || row.questionCount || 1);
  }

  // ---- 本機 ----

  /**
   * 本機榜上那一行的時間。
   *
   * 兩個原因不用 toISOString().slice(0, 10)：
   * 一、**那是 UTC**。台灣時間半夜十二點到早上八點玩的那幾局，會被記成前一天。
   * 二、**只到「日」不夠**。同一天玩十局，榜上十行都寫同一個日期，
   *     根本看不出哪一行是哪一局——而本機榜的用途就是「跟自己比」。
   */
  function stamp() {
    var now = new Date();

    function two(value) {
      return (value < 10 ? '0' : '') + value;
    }

    return two(now.getMonth() + 1) + '/' + two(now.getDate()) +
      ' ' + two(now.getHours()) + ':' + two(now.getMinutes());
  }

  function localKey(mode, questionCount, languages) {
    return 'songquiz.board.' + mode + '.' + questionCount + '.' + languages.join('-');
  }

  function readRaw(key) {
    try {
      var rows = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      // 壞掉的資料就當沒有。為了一份排行榜讓整個結算頁掛掉不值得。
      return [];
    }
  }

  /**
   * 把這一局記進本機榜。**這是自動的**，不問任何人。
   * 回傳這一局在「同組設定」裡排第幾——玩家想知道的是這一局，不是最好的那一局。
   */
  function addLocal(entry) {
    var key = localKey(entry.mode, entry.questionCount, entry.languages);
    var rows = readRaw(key);

    rows.push({
      score: entry.score,
      stage: entry.stage,
      correct: entry.correct,
      total: entry.total,
      at: stamp(),
    });

    rows.sort(function (a, b) {
      return b.score - a.score;
    });

    var rank = rows.indexOf(rows.filter(function (row) {
      return row.score === entry.score;
    })[0]) + 1;

    try {
      localStorage.setItem(key, JSON.stringify(rows.slice(0, LOCAL_KEEP)));
    } catch (e) {
      // 記不住就算了
    }

    return { rank: rank, of: rows.length };
  }

  /**
   * 掃本機的紀錄。
   *
   * 直接掃 localStorage 的 key，不另外維護索引：索引會和真實資料不同步，
   * 而這裡最多幾十個 key，掃一遍是毫秒級的事。
   */
  function queryLocal(filter) {
    var rows = [];
    var prefix = 'songquiz.board.' + filter.mode + '.';

    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key.indexOf(prefix) !== 0) continue;

        // key 的形狀：songquiz.board.<模式>.<題數>.<語種-語種…>
        var parts = key.split('.');
        var count = Number(parts[3]);
        var languages = (parts[4] || '').split('-');

        if (filter.questionCount && count !== filter.questionCount) continue;
        if (filter.language && languages.indexOf(filter.language) === -1) continue;

        readRaw(key).forEach(function (row) {
          rows.push({
            name: row.at,
            score: row.score,
            correct: row.correct,
            total: row.total,
            questionCount: count,
            languages: languages,
          });
        });
      }
    } catch (e) {
      return [];
    }

    return rank(rows, filter);
  }

  /**
   * 清掉這台裝置上的所有紀錄。回傳清掉幾組設定。
   *
   * 只刪 songquiz.board.* ——音量、暱稱、上次挑的設定不該被一起帶走，
   * 那些不是「成績」。要整個清空的人本來就會去清瀏覽器的網站資料。
   *
   * 先收集再刪：邊走 localStorage 邊 removeItem 會讓索引位移，漏掉一半。
   */
  function clearLocal() {
    var keys = [];

    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key.indexOf('songquiz.board.') === 0) keys.push(key);
      }

      keys.forEach(function (key) {
        localStorage.removeItem(key);
      });
    } catch (e) {
      return 0;
    }

    return keys.length;
  }

  // ---- 線上 ----
  // 直接打 Supabase 的 REST（PostgREST），不載 SDK：
  // 為了一次 insert 與一次 select 去載 218 KB 不值得。

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

  /** 送一筆到線上榜。只有使用者按下按鈕才會走到這裡。 */
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

  function queryOnline(filter) {
    if (!online()) return Promise.reject(new Error('線上榜沒有設定'));

    // created_at 要撈：暱稱沒有唯一性（沒有帳號，RLS 只給 insert），
    // 榜上出現兩個「阿明」是常態，要有東西分得開他們。
    var path = 'scores?select=nickname,created_at,score,stage,correct,total,question_count,languages' +
      '&mode=eq.' + encodeURIComponent(filter.mode);

    if (filter.questionCount) path += '&question_count=eq.' + filter.questionCount;

    // 語種是存成「mandarin-western」這種字串，所以「有包含這個語種的場次」
    // 用模糊比對。存成陣列欄位會比較漂亮，但那要改表，而這個查詢一天跑不到幾次。
    if (filter.language) path += '&languages=like.*' + encodeURIComponent(filter.language) + '*';

    // 不分題數的時候要照每題平均分排，而那不是資料表的欄位，叫不動資料庫排——
    // 抓一批回來自己算。超過 SCAN 列之後，極端的「低分但高平均」可能被漏掉。
    path += '&order=score.desc&limit=' + (filter.questionCount ? TOP : SCAN);

    return rest(path).then(function (rows) {
      return rank((rows || []).map(function (row) {
        return {
          name: row.nickname,
          at: row.created_at || null,
          score: row.score,
          correct: row.correct,
          total: row.total,
          questionCount: row.question_count,
          languages: String(row.languages || '').split('-'),
        };
      }), filter);
    });
  }

  /** 照篩選條件決定怎麼排，並切到前 TOP 名。 */
  function rank(rows, filter) {
    var byAverage = !filter.questionCount;

    rows.sort(function (a, b) {
      return byAverage ? perQuestion(b) - perQuestion(a) : b.score - a.score;
    });

    var picked = rows.slice(0, TOP).map(function (row, i) {
      row.rank = i + 1;
      row.average = Math.round(perQuestion(row));
      return row;
    });

    // 同名的人要標出來。暱稱沒有唯一性也不可能有——沒有帳號，
    // 而且 RLS 只開 insert，第二個「阿明」擋不掉也不該擋（擋了他就上不了榜）。
    // 所以不是去避免重複，是讓重複的那幾列分得開：只有真的撞名才加日期，
    // 沒撞名的列不要多一串沒用的字。
    var seen = {};
    picked.forEach(function (row) {
      seen[row.name] = (seen[row.name] || 0) + 1;
    });
    picked.forEach(function (row) {
      row.duplicated = seen[row.name] > 1;
    });

    return { byAverage: byAverage, rows: picked };
  }


  /** 一次查詢的入口。source 是 'local' 或 'online'。 */
  function query(source, filter) {
    if (source === 'online') return queryOnline(filter);
    return Promise.resolve(queryLocal(filter));
  }

  window.Leaderboard = {
    available: online,
    addLocal: addLocal,
    submit: submit,
    query: query,
    clearLocal: clearLocal,
    perQuestion: perQuestion,
  };
})();
