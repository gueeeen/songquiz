// 完整回饋表單。
//
// 整份問卷是一份「清單」（底下的 SECTIONS），畫面照著清單長出來。
// 這樣做的理由：這份表單一定會一直改——加一個模式、加一個功能、改一次選項。
// 如果每一題都寫死在 HTML 裡，語種與模式的清單遲早會和 rules.js 分岔，
// 然後出現「遊戲裡有這個模式，問卷裡沒有」這種問題。
//
// 三個設計決定，都是為了同一件事——長表單最容易發生的是填到一半放棄：
//
// 一、**只問玩過的**。沒玩過的模式、沒注意到的功能就不展開。九個模式全部攤開
//     是九組星星，其中大部分人答不出來，硬填只會得到雜訊。
// 二、**進度條**。放棄的人多半不是不想填，是不知道還有多長。
// 3、**草稿自動存**。填到一半關掉、手機跳出通知、不小心上一頁——
//     沒有草稿的話那些都等於從頭來過，而沒有人會從頭來過第二次。

(function () {
  'use strict';

  var Rules = window.Rules;
  var config = window.REALTIME_CONFIG || {};
  var DRAFT_KEY = 'songquiz.form.draft';

  function el(id) {
    return document.getElementById(id);
  }

  // ---------------------------------------------------------------- 題目

  /** 九種玩法。單人三種，多人是「計分方式 × 出題方式」的六種組合。 */
  var MODES = [
    { key: 'solo-stage', label: '闖關（單人）' },
    { key: 'solo-speed', label: '競速（單人）' },
    { key: 'solo-combo', label: '積分（單人）' },
    { key: 'room-steal-stage', label: '搶答 ＋ 闖關（多人）' },
    { key: 'room-steal-random', label: '搶答 ＋ 隨機（多人）' },
    { key: 'room-speed-stage', label: '競速 ＋ 闖關（多人）' },
    { key: 'room-speed-random', label: '競速 ＋ 隨機（多人）' },
    { key: 'room-combo-stage', label: '積分 ＋ 闖關（多人）' },
    { key: 'room-combo-random', label: '積分 ＋ 隨機（多人）' },
  ];

  /** 美術可以講的幾個面向。滿意與不滿意共用同一份清單。 */
  var LOOKS = ['排版', '色調', '顏色', '背景', '字體大小', '按鈕好不好按', '動畫', '圖示'];

  /** 遊戲裡有、但不一定被注意到的功能。 */
  var FEATURES = [
    { key: 'mailbox', label: '意見箱（左下角的信箱）' },
    { key: 'theme', label: '日間／夜間切換' },
    { key: 'volume', label: '音量調整' },
    { key: 'test', label: '試聽' },
    { key: 'board-online', label: '線上排行榜' },
    { key: 'board-local', label: '這台裝置的排行榜' },
    { key: 'room', label: '多人房間' },
    { key: 'replay', label: '結算頁的重聽' },
    { key: 'quit', label: '設定裡的「回到主畫面」' },
  ];

  /** 2-1 建議增加的語種。單選，所以要有一個「都夠了」。 */
  var MORE_LANGUAGES = [
    '粵語', '泰語', '西班牙語', '動漫／遊戲歌', '台語老歌', '西洋老歌',
    '現在這些就夠了', '其他（寫在下面）',
  ];

  var SECTIONS = [
    {
      key: 'overall',
      title: '一、整體滿意度',
      stars: { key: 'overall', label: '整體給幾顆星' },
      why: { key: 'overallWhy', label: '原因／建議', hint: '什麼地方讓你想再玩一次，或什麼地方讓你想關掉' },
    },
    {
      key: 'songs',
      title: '二、歌單滿意度',
      stars: { key: 'songs', label: '歌單給幾顆星' },
      groups: [
        {
          kind: 'multi',
          key: 'playedLanguages',
          label: '你玩過哪些語種',
          hint: '可以多選',
          options: function () {
            return Rules.LANGUAGES.map(function (language) {
              return { key: language, label: Rules.nameOf(language) };
            });
          },
        },
        {
          kind: 'single',
          key: 'wantLanguage',
          label: '最希望增加哪一種歌',
          hint: '只能選一個——選得出「最想要哪一個」才有參考價值',
          options: function () {
            return MORE_LANGUAGES.map(function (name) { return { key: name, label: name }; });
          },
        },
      ],
      why: { key: 'songsWhy', label: '原因／建議', hint: '哪一首出現得太頻繁、哪個年代的歌太少、想聽到誰' },
    },
    {
      key: 'modes',
      title: '三、遊戲模式滿意度',
      stars: { key: 'modes', label: '整體玩法給幾顆星' },
      groups: [
        {
          kind: 'multi',
          key: 'playedModes',
          label: '你玩過哪些模式',
          hint: '選了才會問下面那一項的分數',
          options: function () { return MODES; },
          // 勾了哪個就展開哪個的星等。沒玩過的模式問了也只是雜訊。
          reveals: { kind: 'stars', key: 'modeStars', labelOf: function (option) { return option.label; } },
        },
      ],
      why: { key: 'modesWhy', label: '原因／建議', hint: '哪個模式最好玩、哪個規則看不懂、十二秒夠不夠' },
    },
    {
      key: 'looks',
      title: '四、美術滿意度',
      stars: { key: 'looks', label: '美術給幾顆星' },
      groups: [
        {
          kind: 'multi',
          key: 'looksGood',
          label: '哪幾項你覺得好',
          hint: '可以多選',
          options: function () {
            return LOOKS.map(function (name) { return { key: name, label: name }; });
          },
        },
        {
          kind: 'multi',
          key: 'looksBad',
          label: '哪幾項你覺得不好',
          hint: '可以多選；同一項可以同時出現在上下兩排（例如「顏色好看但看不清楚」）',
          options: function () {
            return LOOKS.map(function (name) { return { key: name, label: name }; });
          },
        },
      ],
      why: { key: 'looksWhy', label: '原因／建議', hint: '在什麼環境下看的（白天室外、昏暗房間…）對這一項特別有幫助' },
    },
    {
      key: 'features',
      title: '五、其他功能滿意度',
      stars: { key: 'features', label: '其他功能整體給幾顆星' },
      groups: [
        {
          kind: 'multi',
          key: 'noticedFeatures',
          label: '你有注意到哪些功能',
          hint: '沒注意到的就不用選——「沒被發現」本身就是我們要知道的事',
          options: function () { return FEATURES; },
          reveals: { kind: 'stars', key: 'featureStars', labelOf: function (option) { return option.label; } },
        },
      ],
      why: { key: 'featuresWhy', label: '原因／建議' },
      extra: { key: 'wantFeature', label: '你希望增加什麼新功能', hint: '想到什麼寫什麼，不用完整' },
    },
    {
      key: 'other',
      title: '六、其他',
      why: { key: 'other', label: '還有什麼想調整或增加的', hint: '前面沒問到的都寫在這裡' },
    },
  ];

  // ---------------------------------------------------------------- 狀態

  /**
   * 一份回答。key 對應上面清單裡的 key。
   * 星等 0 代表「還沒給」——不是 0 分，送出的時候必填的那幾個不能是 0。
   */
  var answers = {
    stars: {},        // 大項星等
    modeStars: {},    // 每個玩過的模式
    featureStars: {}, // 每個注意到的功能
    multi: {},        // 複選
    single: {},       // 單選
    text: {},         // 文字
  };

  function loadDraft() {
    try {
      var raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      ['stars', 'modeStars', 'featureStars', 'multi', 'single', 'text'].forEach(function (bucket) {
        if (saved[bucket]) answers[bucket] = saved[bucket];
      });
    } catch (error) {
      // 草稿壞掉不該讓整份表單開不起來——當作沒有草稿就好。
    }
  }

  function saveDraft() {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(answers));
    } catch (error) {
      // 無痕視窗會擋。存不了草稿可以接受，表單本身照常運作。
    }
  }

  // ---------------------------------------------------------------- 元件

  /** 五顆星。點同一顆可以取消（回到「還沒給」）。 */
  function stars(current, onChange) {
    var host = document.createElement('div');
    host.className = 'stars';
    host.setAttribute('role', 'radiogroup');

    var buttons = [];

    for (var i = 1; i <= 5; i++) {
      (function (score) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'star';
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-label', score + ' 顆星');
        button.textContent = '★';
        button.addEventListener('click', function () {
          paint(score === value() ? 0 : score);
          onChange(value());
        });
        buttons.push(button);
        host.append(button);
      })(i);
    }

    var picked = current || 0;

    function value() { return picked; }

    function paint(next) {
      picked = next;
      buttons.forEach(function (button, index) {
        button.classList.toggle('on', index < picked);
        button.setAttribute('aria-checked', index + 1 === picked ? 'true' : 'false');
      });
    }

    paint(picked);
    return host;
  }

  function chip(label, on, onClick) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = label;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.addEventListener('click', function () {
      var next = button.getAttribute('aria-pressed') !== 'true';
      onClick(next, button);
    });
    return button;
  }

  function field(label, hint) {
    var wrap = document.createElement('div');
    wrap.className = 'form-field';

    var name = document.createElement('span');
    name.className = 'form-lab';
    name.textContent = label;

    if (hint) {
      var note = document.createElement('i');
      note.textContent = hint;
      name.append(note);
    }

    wrap.append(name);
    return wrap;
  }

  function textarea(key, rows) {
    var box = document.createElement('textarea');
    box.rows = rows || 3;
    box.maxLength = 1000;
    box.value = answers.text[key] || '';
    box.addEventListener('input', function () {
      answers.text[key] = box.value;
      saveDraft();
      refreshProgress();
    });
    return box;
  }

  // ---------------------------------------------------------------- 畫面

  /**
   * 必填的星等有哪些，是**現算**的，不是一邊畫一邊累積的。
   *
   * 累積過一版，壞在這裡：細項（勾了模式才展開的那些）每重畫一次就再 push 一份，
   * 勾了又取消之後清單裡會留著指向已經消失的元素的項目，
   * 於是「還有 N 個沒給」的 N 是錯的，而且那幾項永遠填不到——表單送不出去。
   * 現算的版本不可能和畫面分岔：它讀的就是答案本身。
   *
   * nodes 只是「這個 key 對應畫面上哪一塊」，用來標紅和捲過去。
   */
  var nodes = {};

  function requiredList() {
    var list = [];

    SECTIONS.forEach(function (section) {
      if (section.stars) {
        var key = 'stars:' + section.stars.key;
        list.push({
          key: key,
          value: answers.stars[section.stars.key] || 0,
          name: section.title,
        });
      }

      (section.groups || []).forEach(function (group) {
        if (!group.reveals) return;

        var bucket = group.reveals.key;
        var picked = answers.multi[group.key] || [];
        var options = group.options();

        options.forEach(function (option) {
          if (picked.indexOf(option.key) === -1) return;
          list.push({
            key: bucket + ':' + option.key,
            value: (answers[bucket] || {})[option.key] || 0,
            name: group.reveals.labelOf(option),
          });
        });
      });
    });

    return list;
  }

  function build() {
    var host = el('sections');
    host.replaceChildren();
    nodes = {};


    SECTIONS.forEach(function (section) {
      var card = document.createElement('section');
      card.className = 'card form-card';

      var title = document.createElement('h2');
      title.textContent = section.title;
      card.append(title);

      if (section.stars) buildStars(card, section);
      if (section.groups) section.groups.forEach(function (group) { buildGroup(card, group); });
      if (section.why) buildText(card, section.why);
      if (section.extra) buildText(card, section.extra);

      host.append(card);
    });

    refreshProgress();
  }

  function buildStars(card, section) {
    var wrap = field(section.stars.label + '（必填）');
    wrap.classList.add('form-stars');
    wrap.append(stars(answers.stars[section.stars.key], function (value) {
      answers.stars[section.stars.key] = value;
      wrap.classList.remove('missing');
      saveDraft();
      refreshProgress();
    }));
    card.append(wrap);
    nodes['stars:' + section.stars.key] = wrap;
  }


  function buildGroup(card, group) {
    var wrap = field(group.label, group.hint);
    var chips = document.createElement('div');
    chips.className = 'chips';

    // 勾了才展開的細項星等掛在這裡。
    var revealed = document.createElement('div');
    revealed.className = 'form-revealed';

    var options = group.options();

    options.forEach(function (option) {
      var on = group.kind === 'multi'
        ? (answers.multi[group.key] || []).indexOf(option.key) !== -1
        : answers.single[group.key] === option.key;

      var button = chip(option.label, on, function (next, self) {
        if (group.kind === 'single') {
          // 單選：把同一排的其他顆關掉。
          answers.single[group.key] = next ? option.key : null;
          var all = chips.querySelectorAll('.chip');
          for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', 'false');
          self.setAttribute('aria-pressed', next ? 'true' : 'false');
        } else {
          var picked = answers.multi[group.key] || [];
          var at = picked.indexOf(option.key);
          if (next && at === -1) picked.push(option.key);
          if (!next && at !== -1) picked.splice(at, 1);
          answers.multi[group.key] = picked;
          self.setAttribute('aria-pressed', next ? 'true' : 'false');
        }

        saveDraft();
        if (group.reveals) renderRevealed(group, revealed, options);
        refreshProgress();
      });

      chips.append(button);
    });

    wrap.append(chips);
    if (group.reveals) {
      wrap.append(revealed);
      renderRevealed(group, revealed, options);
    }
    card.append(wrap);
  }

  /**
   * 依複選的結果展開細項星等。
   *
   * 每次重畫整塊而不是增刪單一列：取消勾選之後那一列的分數也要跟著消失，
   * 否則會送出一個「沒玩過卻有分數」的答案，而那種資料比沒有資料更糟。
   */
  function renderRevealed(group, host, options) {
    var bucket = group.reveals.key;
    var picked = answers.multi[group.key] || [];

    host.replaceChildren();

    // 沒選的那些，分數要清掉。
    Object.keys(answers[bucket] || {}).forEach(function (key) {
      if (picked.indexOf(key) === -1) delete answers[bucket][key];
    });

    if (!picked.length) return;

    var hint = document.createElement('p');
    hint.className = 'form-hint';
    hint.textContent = '選了的每一項都要給星（這也是必填）：';
    host.append(hint);

    options.forEach(function (option) {
      if (picked.indexOf(option.key) === -1) return;

      var row = document.createElement('div');
      row.className = 'form-row';

      var name = document.createElement('span');
      name.className = 'form-row-lab';
      name.textContent = group.reveals.labelOf(option);

      answers[bucket] = answers[bucket] || {};
      row.append(name, stars(answers[bucket][option.key], function (value) {
        answers[bucket][option.key] = value;
        row.classList.remove('missing');
        saveDraft();
        refreshProgress();
      }));

      host.append(row);
      nodes[bucket + ':' + option.key] = row;
    });

  }

  function buildText(card, spec) {
    var wrap = field(spec.label, spec.hint);
    wrap.append(textarea(spec.key));
    card.append(wrap);
  }

  // ---------------------------------------------------------------- 進度

  function refreshProgress() {
    var list = requiredList();
    var total = list.length;
    var done = list.filter(function (item) { return item.value > 0; }).length;
    var percent = total ? Math.round((done / total) * 100) : 0;


    el('progress-bar').style.width = percent + '%';
    el('progress').setAttribute('aria-valuenow', String(percent));
    el('progress').setAttribute('aria-label', '必填的星等已完成 ' + done + ' / ' + total);
  }

  // ---------------------------------------------------------------- 送出

  function available() {
    return config.provider === 'supabase' && !!config.url && !!config.anonKey;
  }

  /**
   * 顯示狀態。
   *
   * 預設頁首與頁尾各寫一次，因為這份表單很長——出錯的時候不知道人捲到哪裡，
   * 只寫一個位置很可能在畫面外。
   *
   * 但**送出成功之後只留一個**：那時整份表單已經被清空，兩句一模一樣的
   * 「收到了，謝謝」會上下緊貼著出現，看起來像壞掉。
   */
  function say(text, kind, onlyTop) {
    el('state').className = 'form-state' + (kind ? ' ' + kind : '');
    el('state').textContent = text;

    el('state-bottom').className = 'form-state' + (kind ? ' ' + kind : '');
    el('state-bottom').textContent = onlyTop ? '' : text;
  }

  function device() {
    var agent = (window.navigator && window.navigator.userAgent) || '';
    return (agent.slice(0, 160) + ' | ' + window.innerWidth + 'x' + window.innerHeight).slice(0, 200);
  }

  function payload() {
    return {
      overall: answers.stars.overall,
      songs: answers.stars.songs,
      modes: answers.stars.modes,
      looks: answers.stars.looks,
      features: answers.stars.features,
      answers: {
        modeStars: answers.modeStars,
        featureStars: answers.featureStars,
        playedLanguages: answers.multi.playedLanguages || [],
        wantLanguage: answers.single.wantLanguage || null,
        playedModes: answers.multi.playedModes || [],
        looksGood: answers.multi.looksGood || [],
        looksBad: answers.multi.looksBad || [],
        noticedFeatures: answers.multi.noticedFeatures || [],
        overallWhy: answers.text.overallWhy || '',
        songsWhy: answers.text.songsWhy || '',
        modesWhy: answers.text.modesWhy || '',
        looksWhy: answers.text.looksWhy || '',
        featuresWhy: answers.text.featuresWhy || '',
        wantFeature: answers.text.wantFeature || '',
        other: answers.text.other || '',
      },
      device: device(),
    };
  }

  el('btn-submit').addEventListener('click', function () {
    var button = this;

    // 沒填的全部標起來，然後捲到第一個。
    // 只講「有東西沒填」而不指出是哪一個，會讓人在一份長表單裡自己找。
    var missing = requiredList().filter(function (item) { return item.value === 0; });
    if (missing.length) {
      missing.forEach(function (item) {
        if (nodes[item.key]) nodes[item.key].classList.add('missing');
      });
      if (nodes[missing[0].key]) nodes[missing[0].key].scrollIntoView({ block: 'center' });
      say('還有 ' + missing.length + ' 個星等沒給（已經標成紅色），最上面那個是「' +
        missing[0].name + '」。', 'bad');
      return;
    }


    if (!available()) {
      say('送不出去：這一頁還沒設定 Supabase（realtime-config.js）。', 'bad');
      return;
    }

    button.disabled = true;
    say('送出中…');

    window.fetch(config.url + '/rest/v1/feedback_form', {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: 'Bearer ' + config.anonKey,
        'Content-Type': 'application/json',
        // 不要回傳內容：那張表不給讀，要了也拿不到，只會多一次失敗。
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload()),
    }).then(function (response) {
      if (response.ok) return null;
      return response.text().then(function (text) {
        if (response.status === 404 || text.indexOf('feedback_form') !== -1) {
          throw new Error('資料表還沒建——把 tools/supabase-回饋表單.sql 貼到 Supabase 的 SQL Editor 跑一次。');
        }
        throw new Error('HTTP ' + response.status + '：' + text.slice(0, 120));
      });
    }).then(function () {
      // 送出去之後草稿就沒用了，留著只會在下次進來時看到一份填好的舊表單。
      try { window.localStorage.removeItem(DRAFT_KEY); } catch (error) { /* 擋了就算了 */ }

      el('sections').replaceChildren();
      el('btn-clear').hidden = true;
      button.hidden = true;
      say('收到了，謝謝你花這些時間。回遊戲的連結在右上角。', 'ok', true);
      window.scrollTo(0, 0);
    }).catch(function (error) {
      button.disabled = false;
      say('送不出去：' + error.message, 'bad');
    });
  });

  el('btn-clear').addEventListener('click', function () {
    if (!window.confirm('要清掉這份草稿重新填嗎？這個動作沒辦法復原。')) return;

    try { window.localStorage.removeItem(DRAFT_KEY); } catch (error) { /* 擋了就算了 */ }
    answers = { stars: {}, modeStars: {}, featureStars: {}, multi: {}, single: {}, text: {} };
    build();
    say('草稿清掉了。', '');
    window.scrollTo(0, 0);
  });

  // ---------------------------------------------------------------- 起手

  loadDraft();
  build();

  if (!available()) {
    say('這一頁還沒設定 Supabase（realtime-config.js），填得起來但送不出去。', 'bad');
  } else {
    var hasDraft = Object.keys(answers.stars).length > 0 || Object.keys(answers.text).length > 0;
    if (hasDraft) say('接續上次填到一半的草稿。', '');
  }
})();
