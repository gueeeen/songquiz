// 排行榜的畫面。同一個面板放在兩個地方：首頁（隨時想看就看）與結算頁（剛打完）。
//
// 為什麼做成工廠函式、內部一律用 class 不用 id：
// 同一頁要放兩個面板，id 會撞。每個面板只認自己的容器，兩個互不干擾。
//
// 篩選條件（模式／語種／題數）是面板自己的狀態，不是全域的——
// 首頁想看「積分・華語總榜」的同時，結算頁那一個還停在剛打完的那個模式，
// 兩邊互不影響才符合直覺。

(function () {
  'use strict';

  var Rules = window.Rules;
  var Leaderboard = window.Leaderboard;

  var MODES = [
    { key: 'stage', label: '闖關' },
    { key: 'speed', label: '競速' },
    { key: 'combo', label: '積分' },
  ];

  function pill(className, label, pressed) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    return button;
  }

  function row(className) {
    var box = document.createElement('div');
    box.className = className;
    return box;
  }

  /**
   * 建一個排行榜面板。
   *
   * @param {Element} host 放面板的容器
   * @param {Object} options
   *   options.withSubmit 要不要顯示「上傳到線上榜」（只有結算頁要）
   *   options.filter     初始篩選條件
   */
  function create(host, options) {
    options = options || {};

    var state = {
      source: 'local',
      filter: {
        mode: (options.filter && options.filter.mode) || 'speed',
        language: (options.filter && options.filter.language) || null,
        questionCount: (options.filter && options.filter.questionCount) || null,
      },
      /** 要在榜上標出來的那一局（結算頁用）。 */
      highlight: null,
      submitted: false,
      /** 每次查詢遞增，用來丟掉晚到的舊結果。 */
      seq: 0,
    };

    host.replaceChildren();
    host.classList.add('board-box');

    // ---- 來源：這台裝置 ／ 線上 ----
    var sources = row('board-row');
    var localTab = pill('board-tab', '這台裝置', true);
    var onlineTab = pill('board-tab', '線上', false);
    onlineTab.disabled = !Leaderboard.available();
    sources.append(localTab, onlineTab);

    // ---- 模式（這就是「三份總榜」：一個模式一份）----
    var modes = row('board-row');
    var modeButtons = MODES.map(function (mode) {
      var button = pill('board-scope', mode.label, mode.key === state.filter.mode);
      button.dataset.mode = mode.key;
      modes.append(button);
      return button;
    });

    // ---- 語種：全部 ＋ 五個語種 ----
    var langs = row('board-row wrap');
    var langButtons = [{ key: null, label: '不分語種' }].concat(
      Rules.LANGUAGES.map(function (language) {
        return { key: language, label: Rules.nameOf(language) };
      })
    ).map(function (item) {
      var button = pill('board-filter', item.label, item.key === state.filter.language);
      button.dataset.language = item.key === null ? '' : item.key;
      langs.append(button);
      return button;
    });

    // ---- 題數：全部 ＋ 各個題數 ----
    // 每個模式的題數清單不一樣（積分開到 80），所以換模式時要重建這一排，
    // 不然會留著一個那個模式根本挑不到的題數。
    var counts = row('board-row wrap');
    var countButtons = [];

    function renderCounts() {
      counts.replaceChildren();

      var choices = Rules.questionCountsFor(state.filter.mode);
      if (state.filter.questionCount && choices.indexOf(state.filter.questionCount) === -1) {
        state.filter.questionCount = null;
      }

      countButtons = [{ key: null, label: '不分題數' }].concat(
        choices.map(function (count) {
          return { key: count, label: count + ' 題' };
        })
      ).map(function (item) {
        var button = pill('board-filter', item.label, item.key === state.filter.questionCount);
        button.dataset.count = item.key === null ? '' : item.key;
        button.addEventListener('click', function () {
          state.filter.questionCount = button.dataset.count ? Number(button.dataset.count) : null;
          press(countButtons, function (b) { return b === button; });
          refresh();
        });
        counts.append(button);
        return button;
      });
    }

    var note = document.createElement('p');
    note.className = 'board-note';

    var list = document.createElement('ol');
    list.className = 'board-list';

    /**
     * 清空這台裝置的紀錄。只在「這台裝置」那個分頁出現——
     * 線上榜不給客戶端刪（RLS 只開了讀與新增），那是刻意的。
     */
    var clearRow = row('board-clear');
    var clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'board-clear-btn';
    clearButton.textContent = '清空這台裝置的紀錄';
    clearButton.addEventListener('click', function () {
      // 刪掉就回不來了，所以問一次。
      if (!window.confirm('要清掉這台裝置上所有的猜歌紀錄嗎？這個動作沒辦法復原。')) return;

      var cleared = Leaderboard.clearLocal();
      state.highlight = null;
      refresh();
      note.textContent = cleared > 0
        ? '已經清掉這台裝置上的所有紀錄。'
        : '這台裝置本來就沒有紀錄。';
    });
    clearRow.append(clearButton);

    renderCounts();
    host.append(sources, modes, langs, counts, note, list, clearRow);

    // ---- 上傳到線上榜（只有結算頁）----
    var submitBox = null;
    var nickInput = null;
    var submitButton = null;

    if (options.withSubmit) {
      submitBox = row('board-submit');
      submitBox.hidden = true;

      // 不再放說明文字：上傳欄只在「線上」這個分頁出現，鈕上也寫著「上傳到線上榜」，
      // 這兩件事已經把「它只管線上」講完了，再加一段話只是佔位置。
      nickInput = document.createElement('input');
      nickInput.type = 'text';
      nickInput.maxLength = 12;
      nickInput.placeholder = '暱稱（別人會看到）';
      nickInput.autocomplete = 'off';

      submitButton = document.createElement('button');
      submitButton.type = 'button';
      submitButton.className = 'primary';
      submitButton.textContent = '上傳到線上榜';

      var line = row('board-submit-line');
      line.append(nickInput, submitButton);
      submitBox.append(line);
      host.append(submitBox);
    }

    // ---- 行為 ----

    function press(buttons, matches) {
      buttons.forEach(function (button) {
        button.setAttribute('aria-pressed', matches(button) ? 'true' : 'false');
      });
    }

    function describe() {
      var mode = MODES.filter(function (m) { return m.key === state.filter.mode; })[0];
      var parts = [state.source === 'local' ? '這台裝置' : '線上', mode ? mode.label + '模式' : ''];

      parts.push(state.filter.language ? Rules.nameOf(state.filter.language) : '不分語種');
      parts.push(state.filter.questionCount ? state.filter.questionCount + ' 題' : '不分題數');

      return parts.filter(Boolean).join('・');
    }

    function renderRows(result) {
      list.replaceChildren();

      if (result.rows.length === 0) {
        var empty = document.createElement('li');
        empty.className = 'board-empty';
        empty.textContent = state.source === 'local'
          ? '這台裝置在這個條件下還沒有紀錄。'
          : '這個條件下還沒有人上榜——你會是第一個。';
        list.append(empty);
        return;
      }

      result.rows.forEach(function (entry) {
        var item = document.createElement('li');
        if (isHighlighted(entry)) item.className = 'me';

        var rank = document.createElement('b');
        rank.textContent = entry.rank;

        var name = document.createElement('span');
        name.textContent = entry.name;

        var score = document.createElement('i');
        // 不分題數的時候排的是每題平均，那就要顯示平均——
        // 顯示總分卻照平均排，畫面看起來會像排錯了。
        score.textContent = result.byAverage
          ? entry.average + ' 分／題　' + entry.questionCount + ' 題・' +
            entry.languages.map(Rules.nameOf).join('／')
          : entry.score.toLocaleString('en-US') + '　' + entry.correct + '/' + entry.total + ' 題';

        item.append(rank, name, score);
        list.append(item);
      });
    }

    /** 這一列是不是剛剛打完的那一局。分數與題數都要對上，免得誤標別的場次。 */
    function isHighlighted(entry) {
      var mine = state.highlight;
      if (!mine || state.source !== 'local') return false;
      return entry.score === mine.score && (entry.questionCount || entry.total) === mine.total;
    }

    function refresh() {
      var seq = ++state.seq;

      if (state.source === 'online' && !Leaderboard.available()) {
        note.textContent = '線上榜還沒設定（realtime-config.js 沒有填 Supabase）。';
        list.replaceChildren();
        if (submitBox) submitBox.hidden = true;
        clearRow.hidden = true;
        return;
      }

      if (submitBox) {
        submitBox.hidden = !(state.source === 'online' && state.highlight && !state.submitted);
      }

      // 清空鈕只管本機，線上榜不給客戶端刪。
      clearRow.hidden = state.source !== 'local';

      note.textContent = describe() + '　載入中…';

      Leaderboard.query(state.source, state.filter).then(function (result) {
        // 連點好幾個條件的時候，舊查詢可能晚回來，不能讓它蓋掉新的。
        if (seq !== state.seq) return;

        note.textContent = describe() +
          (result.byAverage ? '　照每題平均分排' : '　照總分排') +
          (state.source === 'online' && state.submitted ? '　你的成績已經上榜' : '');

        renderRows(result);
      }).catch(function (err) {
        if (seq !== state.seq) return;
        note.textContent = '讀不到排行榜：' + err.message;
        list.replaceChildren();
      });
    }

    localTab.addEventListener('click', function () {
      state.source = 'local';
      press([localTab, onlineTab], function (b) { return b === localTab; });
      refresh();
    });

    onlineTab.addEventListener('click', function () {
      state.source = 'online';
      press([localTab, onlineTab], function (b) { return b === onlineTab; });
      refresh();
    });

    modeButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        state.filter.mode = button.dataset.mode;
        press(modeButtons, function (b) { return b === button; });
        renderCounts();
        refresh();
      });
    });

    langButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        state.filter.language = button.dataset.language || null;
        press(langButtons, function (b) { return b === button; });
        refresh();
      });
    });

    if (submitButton) {
      submitButton.addEventListener('click', function () {
        var nickname = nickInput.value.trim();
        if (!nickname) return nickInput.focus();

        submitButton.disabled = true;
        if (options.onNickname) options.onNickname(nickname);

        Leaderboard.submit(state.highlight, nickname).then(function () {
          state.submitted = true;
          submitButton.disabled = false;
          submitBox.hidden = true;
          refresh();
        }).catch(function (err) {
          submitButton.disabled = false;
          note.textContent = '上傳失敗：' + err.message;
        });
      });
    }

    return {
      /** 結算頁用：告訴面板「剛剛打完這一局」，並把條件對齊那一局的模式。 */
      showRun: function (entry, nickname) {
        state.highlight = entry;
        state.submitted = false;
        state.filter.mode = entry.mode;

        // 條件刻意回到「不分語種、不分題數」：那是最不會空的一份榜，
        // 想比同樣設定的人再自己按。
        state.filter.language = null;
        state.filter.questionCount = null;

        press(modeButtons, function (b) { return b.dataset.mode === entry.mode; });
        press(langButtons, function (b) { return !b.dataset.language; });
        renderCounts();

        if (nickInput) nickInput.value = nickname || '';
        refresh();
      },

      /** 首頁用：把條件對齊目前挑的模式，然後重新查。 */
      focusMode: function (mode) {
        state.filter.mode = mode;
        press(modeButtons, function (b) { return b.dataset.mode === mode; });
        refresh();
      },

      refresh: refresh,
    };
  }

  window.BoardUI = { create: create };
})();
