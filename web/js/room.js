// 多人房間：房主開一間、朋友輸房號進來、一起猜歌，最後比分數。
//
// 和單人版住在同一頁（index.html），由 shell.js 切換誰露臉。
// 兩邊的 DOM 完全分開：房間這一半的 id 都有 r- 前綴，class 選取也限定在 #room-app 裡，
// 否則兩邊的 .choice、.mode 會互相抓到對方的節點。
// 它只借用單人版的三個純邏輯層（rules／questions／game），一行都沒有改到它們。
//
// 兩件事值得先講清楚，看下面的程式才不會覺得奇怪：
//
// 一、**Game 在這裡只當「出題器」。** 真正的計分是房間自己的（三種方式，見 Rules.ROOM_SCORINGS），
//     Game 的 totalScore 在這一頁是沒有意義的數字，不要去讀它。
//
// 二、**沒有伺服器，所以房主就是裁判。** 搶答模式「誰先」由房主收到訊息的順序決定；
//     另外兩種計分是各算各的，用玩家自己回報的秒數。理由分別寫在 arbitrate() 與
//     Rules.roomScoreFor() 上面。

(function () {
  'use strict';

  var Rules = window.Rules;
  var Realtime = window.Realtime;

  /** 揭曉正解之後停多久再出下一題。短到不無聊，長到看得完「誰搶到」。 */
  var REVEAL_MS = 3500;

  /** 一間房最多幾個人（含房主）。 */
  /**
   * 一間房最多幾個人。
   *
   * 原本是 6，理由是「六個人的名字才排得進一行」——那是版面問題，不是能力問題，
   * 現場實際有人要開到十五、二十個人。量過之後結論是撐得住，但瓶頸不在伺服器：
   *
   *   * **Supabase**：一題約 41 則發送（ask ＋ 每人一則 claim ＋ 每人一則 tally），
   *     派送出去是 41 × 人數 ≈ 820 則。36 題一場約 29,500 則，
   *     免費額度 200 萬則／月大約夠 68 場。20 人的 tally 帶整份分數是 971 bytes，
   *     整場 realtime 流量約 14 MB。都很寬鬆。
   *   * **現場的 Wi-Fi 才是上限**：每人每題要從 Apple 抓 1 MB，二十個人同時玩
   *     等於持續 13 Mbps；開場預備更是「人數 × 囤的首數」的突發——
   *     二十人各囤五首就是一百 MB 同時湧進同一台基地台。
   *     所以 warmCap() 會依人數壓低囤貨量。
   *   * **搶答計分在人多的時候不好玩**：一題只有一個人拿分，二十個人就是十九個
   *     人整題摸不到分。人多建議用「速度」或「積分」。這件事程式不擋，
   *     但開房的畫面會講。
   *   * **不會被 Apple 鎖。** 同一個 IP 實測打過：40 個並行的 1 MB 下載（＝20 人
   *     開場）全部 200、38.7 MB／1.4 秒；720 次請求（＝20 人 36 題一整場的次數）
   *     全部 206，沒有 429／403、沒有 Retry-After。合理——那是公開 CDN 上的靜態
   *     媒體，Apple 自己給 `Cache-Control: public, max-age≈294 天` 和
   *     `Access-Control-Allow-Origin: *`，等於明說可以快取、可以跨來源用。
   *     **會被限速的是另一個東西**：itunes.apple.com 的 search／RSS API 會回
   *     429／403，但那只有離線的題庫產生器在用（見 ItunesClient.cs），
   *     瀏覽器從來不碰它。
   */
  var MAX_PLAYERS = 20;

  /** 人多就少囤幾首，開場才不會把基地台打爆（理由寫在 MAX_PLAYERS）。 */
  function warmCap() {
    var many = Math.max(1, state.players.length);
    if (many <= 4) return 5;
    if (many <= 8) return 3;
    return 2;
  }

  /** 比分板一次列幾個人就要開始摺疊。再多就變成滑動介面了。 */
  var BOARD_ROWS = 8;

  /**
   * 客人送出 hello 之後等多久還沒收到名冊，就當這個房號不存在。
   * 一個來回的訊息其實一兩百毫秒就到，但房主那一頁可能在手機上被系統降速
   * （切到背景、省電模式），所以給得寬一點——誤判「房號不存在」比多等三秒難處理得多。
   */
  var JOIN_TIMEOUT_MS = 8000;

  /**
   * 房間和單人版住在同一頁，所以兩邊的 id 不能撞。
   * 房間那一半的 id 在 HTML 裡一律加了 r- 前綴，這裡自動補上——
   * 這樣 room.js 裡的每一處都還是寫原本那個名字，看得懂也不必逐行改。
   */
  function el(id) {
    return document.getElementById('r-' + id);
  }

  /**
   * 房主等所有人回報「囤好了」的上限。
   *
   * 比 prefetch.js 的 WARM_LIMIT_MS（60 秒）多十秒：客人的預備是收到 start 訊息
   * 才開始算的，本來就比房主晚，所以房主的線要在外面。
   */
  var HOST_WAIT_MS = 70000;

  /** 房間的容器。class 選取一律限定在這裡面，不然會抓到單人版的選項。 */
  var root = document.getElementById('room-app');

  function q(selector) {
    return root.querySelector(selector);
  }

  function qa(selector) {
    return root.querySelectorAll(selector);
  }

  function num(value) {
    return value.toLocaleString('en-US');
  }

  /**
   * 固定種子的亂數（mulberry32）。
   *
   * 為什麼一定要自己帶一顆：所有人要看到同一題、同樣的選項順序，唯一乾淨的作法
   * 就是「同一顆種子跑同一套出題程式」——房主只需要廣播一個整數，
   * 不必逐題把題目、九個選項和它們的順序都傳一遍。
   * Math.random 沒有種子可以固定，所以只能自己寫一顆。
   *
   * mulberry32 選它的理由很單純：短、只用 32 位元整數運算，
   * 在所有瀏覽器上逐位元一致（Math.imul 是規格保證的）。
   * 這裡不需要密碼學強度，需要的是「兩台機器算出來一模一樣」。
   */
  function seededRng(seed) {
    var a = seed >>> 0;

    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var bank = window.SONG_BANK;
  var bankReady = !!(bank && bank.tracks && bank.tracks.length);

  /**
   * 題庫指紋。所有人得用同一份題庫，否則同一顆種子也會抽出不同的歌
   * ——而且畫面上看起來完全正常，只是大家在猜不同的題目。
   * 把它跟著設定一起傳，開場就能抓到「有人的分頁是舊版的」。
   */
  var bankStamp = bankReady ? (bank.generatedAt || '?') + '/' + bank.tracks.length : 'none';

  var bankCounts = {};
  if (bankReady) {
    bank.tracks.forEach(function (track) {
      bankCounts[track.language] = (bankCounts[track.language] || 0) + 1;
    });
  }

  var availableLanguages = Rules.LANGUAGES.filter(function (language) {
    return bankCounts[language];
  });

  var player = el('player');

  // ---- 狀態 ----

  var state = {
    /** 'host'｜'guest'。沒進房之前是 null。 */
    role: null,
    adapter: null,
    roomCode: '',
    myName: '',
    hostId: '',
    /** 名冊。房主自己維護，客人用房主廣播的那一份覆蓋。 */
    players: [],
    settings: null,
    game: null,
    /** 我自己數的題號（1-based）。闖關模式 view.number 每關會歸零，不能拿它當全場題號。 */
    index: 0,
    totalQuestions: 0,
    /** 這一題的正解。從 game.current 抄下來，因為 game.answer() 之後它就沒了。 */
    answerId: null,
    answerLabel: '',
    /** 這一題我還能不能答。答過（不管對錯）或已經被搶走就是 true。 */
    locked: true,
    /** 房主視角：這一題已經有人答對了嗎。 */
    resolved: false,
    /** 房主視角：每個人的連對數（只有積分計分用得到）。 */
    streaks: {},
    /** 這一題出現在我自己畫面上的時刻，用來量我自己的作答秒數。 */
    shownAt: 0,
    /** 這一題的碼表有沒有被「音樂響了」校正過。 */
    clockStarted: false,

    /** 房主視角：這一題誰已經出手過了，避免同一人連點兩次。 */
    claimed: {},
    points: {},
    ticker: null,
    deadline: 0,
    revealTimer: null,
    /** 正解看到什麼時候為止。房主切回前景時靠它判斷是不是已經該推了。 */
    revealAt: 0,
    joinTimer: null,

    /** 這一場進行中才來敲門的人。打完就會被放進 players（見 admitQueued）。 */
    queued: [],
    /** 這一局誰回報過「音檔囤好了」。房主靠它決定什麼時候發第一題。 */
    ready: {},
    /** 房主已經發出第一題了。用來讓「大家都好了」和逾時只生效一次。 */
    asked: false,
    /** 房主等大家回報的逾時（HOST_WAIT_MS）。 */
    readyTimer: null,
  };

  /**
   * 房主開場挑的設定。
   *
   * mode 是「題目怎麼出」，scoring 是「分數怎麼算」——兩件獨立的事。
   * 原本只有 mode，而房間的計分寫死成搶答，所以單人的三個模式在房間裡
   * 看起來像「選了沒差別」。
   */
  var setup = {
    languages: availableLanguages.slice(),
    questionCount: Rules.QUESTIONS_PER_ROUND,
    /** 題數是自己打的（不是清單上的預設值）。 */
    customCount: false,
    mode: 'speed',
    scoring: 'steal',
  };

  var screens = {
    lobby: el('screen-lobby'),
    waiting: el('screen-waiting'),
    play: el('screen-play'),
    result: el('screen-result'),
  };

  function show(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].hidden = key !== name;
    });
  }

  function isHost() {
    return state.role === 'host';
  }

  function nameOfPlayer(id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i].name;
    }
    return '（離線的人）';
  }

  // ---- 連線狀態列 ----

  function setNet(text, tone) {
    var box = el('net-status');
    box.textContent = text;
    box.className = 'net ' + (tone || '');
  }

  function setNotice(text) {
    var box = el('net-notice');
    box.textContent = text || '';
    box.hidden = !text;
  }

  function lobbyError(text) {
    var box = el('lobby-error');
    box.textContent = text || '';
    box.hidden = !text;
  }

  // ---- 挑 adapter ----
  // ?rt=broadcast 可以蓋掉設定檔，強制走同機通道。
  // 這是留給測試工具的後門：就算哪天真的接上了 Supabase，
  // 也還要能用同一台電腦的兩個分頁把整個協定跑一遍。

  function forcedProvider() {
    var match = /[?&]rt=(broadcast|supabase)/.exec(window.location.search);
    return match ? match[1] : null;
  }

  /**
   * 目前選到的線路。離開房間、以及「建房鈕能不能按」都要讀它，
   * 所以它必須是一個活著的變數，不能只是 showPicked 的參數
   * （探測回來後會重新 pick 一次，那時這裡也要跟著換）。
   */
  var picked = { adapter: null, notice: '' };

  function showPicked(next) {
    picked = next;
    setNotice(picked.notice);

    if (!picked.adapter) {
      setNet('多人房間無法使用', 'bad');
      el('btn-create').disabled = true;
      el('btn-join').disabled = true;
    } else {
      setNet(picked.adapter.label + '：未連線', '');
    }
  }

  showPicked(Realtime.pick(forcedProvider()));

  // 載入的當下「這個網址有沒有中繼」還在探測中，所以上面那行字是暫時的。
  // 探測回來之後再問一次——不然在區域網路開的房會一直顯示成別條線。
  Realtime.relayReady().then(function () {
    showPicked(Realtime.pick(forcedProvider()));
  });

  /** 每次進房都要一個乾淨的 adapter（上一間房的 channel 不能留著）。 */
  function freshAdapter() {
    var next = Realtime.pick(forcedProvider());
    var adapter = next.adapter;

    adapter.onStatus(function (status, detail) {
      var words = {
        connecting: '連線中…',
        open: '已連線',
        closed: '已離線',
        error: '連線出問題',
      };
      setNet(adapter.label + '：' + (words[status] || status) +
        (detail ? '（' + detail + '）' : ''),
        status === 'error' ? 'bad' : (status === 'open' ? 'ok' : ''));
    });

    adapter.onMessage(handleMessage);
    return adapter;
  }

  // ---- 設定區（只有房主看得到）----

  function chip(label, pressed, onClick) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = label;
    button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    button.addEventListener('click', onClick);
    return button;
  }

  function renderLanguageChips() {
    var box = el('lang-chips');
    box.replaceChildren();

    availableLanguages.forEach(function (language) {
      var on = setup.languages.indexOf(language) !== -1;
      box.append(chip(Rules.nameOf(language), on, function () {
        var at = setup.languages.indexOf(language);
        if (at !== -1 && setup.languages.length === 1) return;
        if (at === -1) setup.languages.push(language);
        else setup.languages.splice(at, 1);
        setup.languages = Rules.orderLanguages(setup.languages);
        refreshSetup();
      }));
    });
  }

  /**
   * 計分方式的三顆鈕。內容從 Rules.ROOM_SCORINGS 長出來，不寫死在 HTML 裡——
   * 規則層加一種計分方式，畫面就跟著有，不會兩邊分岔。
   */
  function renderScoringButtons() {
    var box = el('scorings');
    var help = el('scorings-help');
    box.replaceChildren();
    help.replaceChildren();

    Rules.ROOM_SCORINGS.forEach(function (scoring) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'mode';
      button.dataset.scoring = scoring.key;
      button.setAttribute('aria-pressed', scoring.key === setup.scoring ? 'true' : 'false');

      var title = document.createElement('strong');
      title.textContent = scoring.label;
      button.append(title);

      // 說明不放在鈕裡，放進「?」展開的那一塊——三段文字常態攤開，
      // 開房這一頁會長到要捲好幾次才看得到「建立房間」。
      var line = document.createElement('p');
      var name = document.createElement('b');
      name.textContent = scoring.label;
      line.append(name, document.createTextNode(scoring.note));
      help.append(line);

      button.addEventListener('click', function () {
        setup.scoring = scoring.key;
        refreshSetup();
      });


      box.append(button);
    });
  }

  /**
   * 題數：預設幾個選項 ＋ 一個「自訂」。
   *
   * 自訂是現場要求的：實際玩起來會想要「36 題」這種不在清單上的數字
   * （人數、時間、想玩多久都會影響）。上限按語種算，見 Rules.countLimitFor。
   */
  function renderCountChips() {
    var box = el('count-chips');
    box.replaceChildren();

    var presets = Rules.questionCountsFor(setup.mode);

    presets.forEach(function (count) {
      box.append(chip(count + ' 題', !setup.customCount && count === setup.questionCount, function () {
        setup.customCount = false;
        setup.questionCount = count;
        refreshSetup();
      }));
    });

    box.append(chip('自訂', setup.customCount, function () {
      setup.customCount = true;
      refreshSetup();
      el('count-input').focus();
    }));

    renderCustomCount();
  }

  function renderCustomCount() {
    var box = el('custom-count');
    box.hidden = !setup.customCount;
    if (!setup.customCount) return;

    var limit = Rules.countLimitFor(setup.languages, setup.mode);
    var input = el('count-input');

    input.min = limit.min;
    input.max = limit.max;
    if (document.activeElement !== input) input.value = setup.questionCount;

    el('count-hint').textContent = setup.mode === 'stage'
      ? limit.min + '～' + limit.max + ' 題（每一關；一個語種最多 ' +
        Rules.MAX_PER_LANGUAGE + ' 題，闖關要再分給各關）'
      : limit.min + '～' + limit.max + ' 題（一個語種最多 ' + Rules.MAX_PER_LANGUAGE + ' 題）';
  }

  el('count-input').addEventListener('input', function () {
    // 打字中不要夾值——正在輸入「36」的人會在打完 3 的時候被跳成 3。
    var wanted = Math.floor(Number(this.value));
    if (!isFinite(wanted) || wanted <= 0) return;

    setup.questionCount = wanted;
    refreshSetup();
  });

  // 焦點離開才夾進合法範圍，並把夾過的值寫回輸入框。
  el('count-input').addEventListener('change', commitCustomCount);
  el('count-input').addEventListener('blur', commitCustomCount);

  function commitCustomCount() {
    var fixed = Rules.clampCount(el('count-input').value, setup.languages, setup.mode);
    setup.questionCount = fixed === null ? Rules.QUESTIONS_PER_ROUND : fixed;
    el('count-input').value = setup.questionCount;
    refreshSetup();
  }

  var modeButtons = qa('.mode');

  for (var m = 0; m < modeButtons.length; m++) {
    modeButtons[m].addEventListener('click', function () {
      setup.mode = this.dataset.mode;

      // 換出題方式可能換掉整份題數清單，要把題數挪到新清單裡最接近的那個。
      // 自訂的題數不要被挪掉（那是使用者自己打的），但還是要夾進新模式的上限——
      // 闖關的上限低很多，因為那個數字會再乘上關卡數。
      setup.questionCount = setup.customCount
        ? Rules.clampCount(setup.questionCount, setup.languages, setup.mode)
        : Rules.nearestCountFor(setup.mode, setup.questionCount);

      refreshSetup();
    });
  }

  function totalQuestionsFor(settings) {
    if (settings.mode !== 'stage') return settings.questionCount;
    return Rules.stagesFor(settings.languages, settings.questionCount, 'stage').length *
      settings.questionCount;
  }

  function scoringLabel(key) {
    var found = Rules.ROOM_SCORINGS.filter(function (s) { return s.key === key; })[0];
    return found ? found.label : key;
  }

  function describeSettings(settings) {
    var names = settings.languages.map(Rules.nameOf).join('／');
    var total = totalQuestionsFor(settings);
    var howQuestions = settings.mode === 'stage' ? '逐關解鎖語種' : '隨機出題';

    // 兩件事都要講：題目怎麼出、分數怎麼算。它們是獨立的選擇。
    return scoringLabel(settings.scoring || 'steal') + ' · ' + howQuestions +
      ' · 共 ' + total + ' 題 · ' + names +
      (settings.mode === 'stage'
        ? '（' + Rules.stagesFor(settings.languages, settings.questionCount, 'stage').length +
          ' 關 × 每關 ' + settings.questionCount + ' 題）'
        : '');
  }

  function refreshSetup() {
    for (var i = 0; i < modeButtons.length; i++) {
      modeButtons[i].setAttribute('aria-pressed',
        modeButtons[i].dataset.mode === setup.mode ? 'true' : 'false');
    }

    renderLanguageChips();
    renderCountChips();
    renderScoringButtons();

    var capacity = bankReady
      ? Rules.capacityFor(bank, setup.languages, setup.questionCount, setup.mode)
      : { ok: false, shortfall: [] };

    el('setup-summary').textContent = bankReady ? describeSettings(setup) : '';

    var warning = el('setup-warning');
    var worst = capacity.shortfall[0];
    warning.textContent = worst
      ? '題庫湊不出' + (worst.stage ? '第 ' + worst.stage + ' 關' : '這一場') + '：' +
        worst.languages.map(Rules.nameOf).join('／') + ' 需要 ' + worst.needed +
        ' 首，只有 ' + worst.available + ' 首。少選幾題，或多勾幾個語種。'
      : '';
    warning.hidden = !warning.textContent;

    el('btn-create').disabled = !capacity.ok || !picked.adapter;
  }

  function describeBank() {
    var line = el('bank-line');

    if (!bankReady) {
      line.textContent = '題庫還沒建。請先執行「重建題庫.cmd」。';
      return;
    }

    // 題庫的張數是給做題庫的人看的，玩的人不需要知道。只在出事時說話。
    line.textContent = '';
  }

  describeBank();
  refreshSetup();

  // ---- 建房 ----

  el('btn-create').addEventListener('click', function () {
    var name = readNickname();
    if (!name) return;

    state.role = 'host';
    state.myName = name;
    state.roomCode = Realtime.makeRoomCode();
    state.settings = {
      mode: setup.mode,
      scoring: setup.scoring,
      languages: setup.languages.slice(),
      questionCount: setup.questionCount,
      // 種子只要是整數就好。用時間 ^ 亂數，是為了「同一台電腦連開兩場」也不會撞。
      seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0,
      bankStamp: bankStamp,
    };

    state.adapter = freshAdapter();
    state.hostId = state.adapter.selfId;
    state.players = [{ id: state.hostId, name: name }];
    state.points = {};

    lobbyError('');

    state.adapter.connect(state.roomCode).then(function () {
      enterWaiting();
    }, function (error) {
      state.role = null;
      lobbyError('開不了房間：' + error.message);
    });
  });

  // ---- 加入 ----

  var joinInput = el('join-code');

  joinInput.addEventListener('input', function () {
    // 一邊打一邊正規化，這樣畫面上看到的就是真的會被拿去用的房號。
    var caretAtEnd = joinInput.selectionStart === joinInput.value.length;
    joinInput.value = Realtime.normalizeRoomCode(joinInput.value);
    if (caretAtEnd) joinInput.selectionStart = joinInput.selectionEnd = joinInput.value.length;
  });

  el('btn-join').addEventListener('click', function () {
    var name = readNickname();
    if (!name) return;

    var code = Realtime.normalizeRoomCode(joinInput.value);
    if (code.length !== Realtime.CODE_LENGTH) {
      return lobbyError('房號是 ' + Realtime.CODE_LENGTH + ' 個英數字，再確認一下。');
    }

    state.role = 'guest';
    state.myName = name;
    state.roomCode = code;
    state.players = [];
    state.points = {};

    state.adapter = freshAdapter();
    lobbyError('連線中…');

    state.adapter.connect(code).then(function () {
      state.adapter.send('hello', { name: name });

      // 房主不在（或房號打錯）的時候沒有人會回話，只能靠等。
      // 這是不自架伺服器的必然代價：沒有一個地方可以問「這間房存在嗎」。
      state.joinTimer = setTimeout(function () {
        leaveRoom();
        lobbyError('房號 ' + code + ' 沒有人回應。確認房主還開著那一頁，也確認房號沒打錯。' +
          (state.adapter && !state.adapter.crossDevice
            ? '（現在走的是同機通道，跨裝置要先設定 realtime-config.js）'
            : ''));
      }, JOIN_TIMEOUT_MS);
    }, function (error) {
      state.role = null;
      lobbyError('連不上：' + error.message);
    });
  });

  function readNickname() {
    var name = el('nick').value.trim().slice(0, 12);
    if (!name) {
      lobbyError('先取個暱稱，別人才知道是誰搶到的。');
      el('nick').focus();
      return null;
    }
    el('nick').value = name;
    return name;
  }

  // ---- 等待室 ----

  function enterWaiting() {
    el('room-code').textContent = state.roomCode;
    el('room-settings').textContent = describeSettings(state.settings);
    el('btn-start-round').hidden = !isHost();
    el('waiting-hint').textContent = isHost()
      ? '把房號念給朋友，他們在自己的裝置上輸入就能進來。人到齊了按開始。'
      : '已經進房了，等房主按開始。';

    renderPlayers();
    if (isHost()) el('waiting-hint').textContent += bigRoomAdvice();
    show('waiting');

    if (isHost()) broadcastRoster('waiting');
  }

  function renderPlayers() {
    var list = el('player-list');
    list.replaceChildren();

    state.players.forEach(function (person) {
      var item = document.createElement('li');
      item.textContent = person.name;
      if (person.id === state.hostId) item.className = 'host';
      if (person.id === state.adapter.selfId) item.textContent += '（你）';
      list.append(item);
    });

    // 排隊中的人也列出來。房主要知道有人在等，排隊的人也要看到自己在名單上。
    state.queued.forEach(function (person) {
      var item = document.createElement('li');
      item.className = 'queued';
      item.textContent = person.name +
        (person.id === state.adapter.selfId ? '（你）' : '') + '・下一場加入';
      list.append(item);
    });

    el('player-count').textContent = state.players.length + ' 人' +
      (state.queued.length > 0 ? '（另有 ' + state.queued.length + ' 人排隊）' : '');
  }

  /**
   * 有人敲門。收下、排隊、或者說滿了。
   *
   * 三條路：
   *   * 已經在名冊裡 → 重發一次名冊就好（他可能是斷線重連的）。
   *   * 這一場正在進行中 → **排隊**，不是趕走。他的連線留著，
   *     這一場打完 admitQueued() 會把他放進名冊。
   *     （原本是趕走的，理由是「臨時加入的人名次看起來像作弊」——
   *     排隊解決的是同一件事，而且不必叫人重新輸入房號。）
   *   * 滿了 → 只能說滿了。
   */
  function admit(id, rawName) {
    var name = String(rawName || '無名').slice(0, 12);

    if (state.players.some(function (p) { return p.id === id; })) {
      broadcastRoster('waiting');
      return;
    }

    if (state.players.length + state.queued.length >= MAX_PLAYERS) {
      replyTo(id, { reason: 'full' });
      return;
    }

    if (state.game) {
      if (!state.queued.some(function (p) { return p.id === id; })) {
        state.queued.push({ id: id, name: name });
      }
      replyTo(id, { reason: 'queued', ahead: state.queued.length });
      renderPlayers();
      return;
    }

    state.players.push({ id: id, name: name });
    renderPlayers();
    broadcastRoster('waiting');
  }

  /** 這一場打完了：把排隊的人放進名冊。 */
  function admitQueued() {
    if (state.queued.length === 0) return;

    state.queued.forEach(function (person) {
      if (!state.players.some(function (p) { return p.id === person.id; })) {
        state.players.push(person);
      }
    });

    state.queued = [];
    renderPlayers();
    broadcastRoster('waiting');
  }

  /** 只給某一個人的回覆。廣播會波及全場（見 case joinReply 的說明）。 */
  function replyTo(id, extra) {
    var payload = {
      to: id,
      hostId: state.hostId,
      settings: state.settings,
      // 名冊也要一起給：排隊的人要看得到自己在等誰，不然畫面上是「0 人」。
      players: state.players,
      queued: state.queued,
    };

    Object.keys(extra).forEach(function (key) { payload[key] = extra[key]; });
    state.adapter.send('joinReply', payload);
  }

  /** 排隊中的畫面。留在房裡，不要退回大廳。 */
  function enterQueued(ahead) {
    el('room-code').textContent = state.roomCode;
    el('room-settings').textContent = describeSettings(state.settings);
    el('btn-start-round').hidden = true;
    el('waiting-hint').textContent = '這一場正在進行中，你排在第 ' + (ahead || 1) +
      ' 位。等他們打完就會自動把你放進來，不用再輸入房號。';

    renderPlayers();
    show('waiting');
  }

  /**
   * 人多的時候給房主兩句話。
   *
   * 兩件事都是量出來的，不是猜的：搶答一題只有一個人拿分（二十人就是十九個人
   * 整題摸不到分），而每人每題要從 Apple 抓 1 MB（二十人同時玩＝持續 13 Mbps）。
   * 程式不擋，但不講就等於讓人在現場才發現。
   */
  function bigRoomAdvice() {
    var many = state.players.length;
    if (many < 9) return '';

    var lines = ['　（' + many + ' 人：'];
    if (scoringOf() === 'steal') {
      lines.push('搶答一題只有一個人拿分，這麼多人建議改「速度」或「積分」；');
    }
    lines.push('人多很吃現場網路，每個人每題都要抓一首歌。）');

    return lines.join('');
  }

  function broadcastRoster(phase) {
    state.adapter.send('roster', {
      hostId: state.hostId,
      players: state.players,
      settings: state.settings,
      phase: phase,
    });
  }

  /** 一個人就開打要按兩次。第一次只是提醒，不是拒絕——測試和「朋友還在路上」都是正當理由。 */
  var soloConfirmed = false;

  el('btn-start-round').addEventListener('click', function () {
    if (!isHost()) return;

    if (state.players.length < 2 && !soloConfirmed) {
      soloConfirmed = true;
      el('waiting-hint').textContent = '只有你一個人——這樣等於單人練習，沒有人可以搶。再按一次就開始。';
      el('btn-start-round').textContent = '還是開始';
      return;
    }

    beginRound();
  });

  function beginRound() {
    // 還在手勢裡：先解鎖播放器。房主的第一次 play() 要等預備結束，
    // 那時候已經離開手勢了。客人沒有這一下（他的 play() 是收到 ask 才發的），
    // 靠 prefetch.js 那個「第一次互動就解鎖」的監聽——他至少按過「加入」。
    prefetch.unlock();

    state.adapter.send('start', { settings: state.settings });
    startWithSettings(state.settings);
  }

  // ---- 開一場 ----

  function startWithSettings(settings) {
    state.settings = settings;
    state.index = 0;
    state.totalQuestions = totalQuestionsFor(settings);
    state.points = {};
    state.streaks = {};

    state.players.forEach(function (person) {
      state.points[person.id] = 0;
    });

    /**
     * 每一台機器都用**完全相同的輸入**推進同一顆 Game，這是「所有人看到同一題」的全部秘密：
     * 同一顆種子（rng）、同一組設定，而且時鐘固定回 0。
     *
     * 為什麼要固定時鐘：Game 會用 now() 算作答秒數去判分，而在闖關模式，
     * 「這一關拿幾分」決定過關或失敗。一旦各人分數不同，關卡進度就會分岔，
     * 下一題開放的語種跟著不同，畫面就再也不是同一題了。
     * 固定時鐘（elapsed 永遠是 0，等於每題都拿單題滿分）＋每題一律餵正解
     * （見 applyAward），所以闖關模式在這裡永遠不會「過不了關」，
     * 而 Game 的內部狀態（rng 走到哪、出過哪些歌、第幾關）在所有人身上逐字相同。
     *
     * 代價是 game.totalScore 變成一個沒有意義的數字——房間本來就不看它，
     * 房間的分數是「你搶到幾題」。
     */
    state.game = new window.Game({
      mode: settings.mode,
      bank: bank,
      languages: settings.languages,
      questionCount: settings.questionCount,
      rng: seededRng(settings.seed),
      now: function () {
        return 0;
      },
    });

    el('q-mode').textContent = describeSettings(settings);
    // 沒有「下一題」鈕了——一切自動推進（見 showVerdict 那段說明）。
    show('play');

    if (settings.bankStamp && settings.bankStamp !== bankStamp) {
      setNotice('警告：你的題庫和房主的不一樣（' + bankStamp + ' vs ' + settings.bankStamp +
        '）。同一顆種子在不同題庫上會抽出不同的歌，這場的題目不會一致。');
    }

    state.ready = {};
    state.asked = false;

    // 上一局的預載狀態要清掉。上一局結束時還在抓的那一首會沉澱到這一局的
    // 進度計數，done 就多算一首不在清單裡的歌：進度條可能超過 100%、
    // 「不等了」立刻冒出來、甚至在這一局一首都沒抓好之前就開場。
    prefetch.drop();

    // 全場一起預備，房主等大家回報再發第一題。
    //
    // **房主的等待一定要比客人的長。** 客人的預備是收到 start 訊息才開始算的，
    // 比房主晚；兩邊用同一個上限的話房主永遠先到線，「等大家」就從來沒真的發生過。
    if (isHost()) {
      clearTimeout(state.readyTimer);
      state.readyTimer = setTimeout(startAsking, HOST_WAIT_MS);
    }

    prefetch.warmUp(function () {
      if (isHost()) return noteReady(state.adapter.selfId);

      // 客人按了「不等了」只是自己不等，畫面還要等房主發題——
      // 鈕上寫「直接開始」但畫面沒動，看起來像壞了，所以把話說清楚。
      prefetch.showWaiting('你這邊準備好了，等其他人…');
      state.adapter.send('ready', {});
    }, warmCap());
  }

  /** 房主出下一題。Game 出不出來（整場結束）就結算。 */
  function askNext() {
    clearTimeout(state.revealTimer);

    var view = state.game.nextQuestion();
    if (!view) return finishRound();

    state.adapter.send('ask', { index: state.index + 1, signature: signatureOf(view) });
    beginQuestion(view);
  }

  /**
   * 這一題的指紋：拿九個選項的字數、按位置加權加起來。
   *
   * 只要題目不同、或選項順序不同，這個數就會不同——正好是要驗的兩件事。
   * 刻意不傳題目本身也不傳正解：這個數看不出答案是哪一個，
   * 而題目是各自用種子算出來的，本來就不需要走網路。
   */
  function signatureOf(view) {
    var sum = 0;
    view.choices.forEach(function (choice, i) {
      sum += (i + 1) * choice.label.length;
    });
    return view.choices.length + ':' + sum;
  }


  /**
   * 音檔預載。整套機制、踩過的坑、和量出來的數字都在 js/prefetch.js。
   *
   * 房間比單人更值得做：單人卡住只有自己在等，房間卡住是全場一起等，而且
   * **卡的人會輸**——搶答比的是誰先按，網路慢的人先天少一秒。開場一起等，
   * 開始之後大家手上都有貨，比的才是耳朵。
   */
  var prefetch = window.AudioPrefetch.create({
    player: player,
    el: el,
    game: function () { return state.game; },
  });

  /**
   * 有人回報囤好了。房主蒐集齊了就開場。
   *
   * 「齊了」用的是**現在房間裡的人**，不是開場那一刻的名單：中途有人離開的話
   * 再等他就永遠等不到。逾時那條線同樣存在，網路特別慢的人不會擋住全場。
   */
  function noteReady(id) {
    state.ready[id] = true;
    if (!isHost() || state.asked) return;

    var everyone = state.players.every(function (person) {
      return state.ready[person.id];
    });

    if (everyone) startAsking();
  }

  function startAsking() {
    if (state.asked) return;
    state.asked = true;

    clearTimeout(state.readyTimer);
    state.readyTimer = null;

    prefetch.hideWarm('載入中…');
    askNext();
  }

  function beginQuestion(view) {
    state.index++;
    state.locked = false;
    state.resolved = false;
    state.claimed = {};
    // 先給一個值，等音樂真的響起來再改（見下面的 playing 監聽）。
    // 沒有它的話，音檔還沒來就有人搶答會除到 undefined。
    state.shownAt = performance.now();
    state.clockStarted = false;


    // 正解要在這裡抄下來：game.answer() 一旦呼叫，game.current 就變 null 了。
    state.answerId = state.game.current.answerId;
    state.answerLabel = window.labelOf(state.game.current.answer);

    el('q-progress').textContent = '第 ' + state.index + ' / ' + state.totalQuestions + ' 題' +
      (view.stageLabel ? '（' + view.stageLabel + '）' : '');
    el('verdict').hidden = true;
    state.revealAt = 0;
    el('play-hint').textContent = '正在播放…最快答對的人拿一分';
    el('play-hint').className = 'hint';

    renderChoices(view.choices);
    renderBoard();
    startTimer(view.seconds);

    // 每個人在自己的裝置上放自己的音檔。放不出來（無頭瀏覽器、自動播放被擋）
    // 不能讓整場停住，所以只是換一句提示。
    //
    // 起點（view.offset）是出題時用那顆共享的種子算出來的，所以每個人都會
    // 聽到同一段——這件事在房間裡是硬需求：兩個人聽到不同片段就不是同一題了。
    // seek 要等 metadata，那時已離開使用者手勢，所以先靜音、play() 照常在手勢裡發動，
    // seek 之後才解除靜音（細節與單人版的 playPreview 一樣）。
    var seeked = false;

    player.src = prefetch.sourceFor(view.previewUrl);
    player.muted = !!view.offset;

    function seek() {
      if (seeked) return;
      seeked = true;

      if (view.offset) {
        var span = Math.max(0, (player.duration || 30) - Rules.QUESTION_SECONDS - 0.5);
        try {
          player.currentTime = view.offset * span;
        } catch (e) {
          // 不給 seek 就從頭放，總比沒聲音好。
        }
      }

      player.muted = false;
    }

    player.addEventListener('loadedmetadata', seek, { once: true });
    setTimeout(seek, 1200);

    // 碼表從「音樂真的響」開始算，不是從「這一題出現」開始算。
    //
    // 競速與積分是各人用自己回報的秒數計分的，所以音檔載得慢的人如果從出題就起算，
    // 等於把他家的網速算進他的實力。房間裡每個人的網路都不一樣，這個差距是直接
    // 反映在名次上的。搶答那一種本來就由房主收到的順序決定，這裡幫不上忙——
    // 那個不公平寫在 arbitrate() 上面。
    //
    // 畫面上那條倒數**不跟著改**，它仍然從出題起算：那是整間房共用的回合時鐘，
    // 房主也照它決定什麼時候收題。所以載得慢的人會看到「剩 3 秒」但計分上只用掉
    // 9 秒——那正是要補給他的那 3 秒，因為他晚 3 秒才聽到音樂。
    //
    // 上一題如果從頭到尾沒響過，它掛的監聽會留在 <audio> 上，然後在這一題響的
    // 時候才觸發，把這一題的碼表重設一次。所以先把舊的拆掉。
    if (playingHook) player.removeEventListener('playing', playingHook);
    playingHook = function () {
      if (state.clockStarted) return;
      state.clockStarted = true;
      state.shownAt = performance.now();
    };
    player.addEventListener('playing', playingHook, { once: true });

    // 這一題開始播了：放掉上一首、補滿前面備著的題數、繼續抓。
    prefetch.questionStarted(view.previewUrl);

    var playing = player.play();
    if (playing && playing.catch) {
      playing.catch(function () {
        el('play-hint').textContent = '瀏覽器擋住了自動播放——點畫面任一處，下一題就會有聲音。';
      });
    }
  }

  /** 目前掛在 <audio> 上的「開始播了」監聽。一次只能有一個。 */
  var playingHook = null;


  function renderChoices(choices) {
    var box = el('choices');
    box.replaceChildren();

    choices.forEach(function (choice) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice';
      button.dataset.id = choice.id;

      // 和單人那邊同一套：歌名一行加粗放大，歌手退成註腳。
      var title = document.createElement('b');
      title.textContent = choice.title;
      var artist = document.createElement('i');
      artist.textContent = choice.artist;
      button.append(title, artist);

      button.addEventListener('click', function () {
        claim(choice.id);
      });
      box.append(button);
    });
  }

  function lockChoices() {
    var buttons = qa('.choice');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
  }

  // ---- 作答 ----

  /**
   * 我按下了一個選項。
   *
   * 對錯是在自己這台機器上判的——答案本來就在瀏覽器裡（純靜態站的既有取捨），
   * 送一個 boolean 和送一個 choiceId 的可信度完全一樣，而送 boolean 少一次
   * 「房主也要有同一份題庫」的假設。房主要驗的是「誰先」，不是「對不對」。
   */
  function claim(choiceId) {
    if (state.locked) return;
    state.locked = true;

    var correct = choiceId === state.answerId;

    // 作答秒數用**自己的**時鐘量（從這一題出現在自己畫面上算起）。
    // 用房主收到訊息的時間算的話，網路慢的人每一題都吃虧，而房主完全不吃虧。
    var elapsed = (performance.now() - state.shownAt) / 1000;

    var pickedButton = q('.choice[data-id="' + choiceId + '"]');
    if (pickedButton) pickedButton.classList.add(correct ? 'mine' : 'wrong');

    lockChoices();

    if (correct) {
      el('play-hint').textContent = stealing()
        ? '送出了，等房主判定…'
        : '答對了，等這一題結束…';
    } else {
      // 答錯不能重答同一題，但題目還沒結束（別人還在答），所以只鎖自己。
      el('play-hint').textContent = stealing()
        ? '答錯了。這一題你出局，看誰搶到。'
        : '答錯了。這一題你沒分，等其他人。';
      el('play-hint').className = 'hint bad';
    }

    if (isHost()) arbitrate(state.adapter.selfId, state.index, correct, elapsed);
    else state.adapter.send('claim', { index: state.index, correct: correct, elapsed: elapsed });
  }

  /** 這一場是不是「先搶到的拿一分」。另外兩種計分方式，答對的人都有分。 */
  function stealing() {
    return scoringOf() === 'steal';
  }

  function scoringOf() {
    return (state.settings && state.settings.scoring) || 'steal';
  }

  /**
   * 「誰先答對」的判定：**由房主仲裁，判準是房主收到 claim 的先後**，
   * 不看玩家自己回報的時間。
   *
   * 為什麼不用玩家的時間戳：
   * 一、沒有共同時鐘。各台機器的 Date.now() 可能差好幾秒，performance.now() 的原點
   *     更是各自的頁面載入時間——兩邊的「0.8 秒」根本不是在量同一件事，
   *     而校時（NTP 式的來回估算）在一個猜歌遊戲上是明顯過頭的工程。
   * 二、這是純靜態站，答案就在瀏覽器裡。讓玩家自報毫秒數等於讓他自己填分數；
   *     而「房主收到的順序」是他改不動的——改了只會讓自己的訊息更晚到。
   * 三、房主是唯一對所有 claim 有「全序」的節點。要有全序就得有一個仲裁者，
   *     不自架伺服器的前提下，房主是唯一自然的選擇。
   *
   * 代價，誠實講：網路慢的人吃虧，而房主的 claim 少走一趟網路，天生就佔便宜。
   * 這在「不自架伺服器」的前提下沒有解，只能不要再加一層不公平——
   * 所以房主自己的 claim 走的是同一個函式、同一個判斷（上面 claim() 直接呼叫它），
   * 不特別優待也不特別懲罰，而且畫面上會寫明「房主裁判」，玩的人知道規則是什麼。
   *
   * 平手：不存在。訊息是一則一則進 handler 的，第一個把 resolved 從 false 翻成 true
   * 的人就是贏家，之後所有 claim 都會看到 resolved === true 而被擋掉。
   * 就算 BroadcastChannel 在同一個 tick 派送好幾則，handler 仍然是依序執行。
   *
   * 慢的人看得到「已經被搶走」：會。判定的同一刻就廣播 award，
   * 所有人立刻鎖選項、看到是誰搶到、看到正解——不用在那裡乾等十二秒。
   */
  function arbitrate(fromId, index, correct, elapsed) {
    if (!isHost()) return;
    if (index !== state.index) return; // 上一題的遲到訊息
    if (state.resolved) return;        // 這一題已經結束了
    if (state.claimed[fromId]) return; // 一人一題只能出手一次
    state.claimed[fromId] = true;

    // 玩家自報的秒數只用來算分，不用來決定名次；而且要夾在合理範圍內，
    // 免得一個壞掉（或造假）的值算出天文數字。
    var seconds = Math.min(Math.max(Number(elapsed) || 0, 0), Rules.QUESTION_SECONDS);

    if (stealing()) return arbitrateSteal(fromId, index, correct);

    // 競速與積分：不必搶，答對的人各自拿各自的分。
    var streak = correct ? (state.streaks[fromId] || 0) + 1 : 0;
    state.streaks[fromId] = streak;

    var gained = Rules.roomScoreFor(scoringOf(), correct, seconds, streak);
    state.points[fromId] = (state.points[fromId] || 0) + gained;

    // points 整份傳出去，而不是只傳增量：掉一則訊息的話，
    // 只傳增量會讓某個人的分數從此永遠少一截，而且沒有人會發現。
    var tally = { index: index, id: fromId, gained: gained, streak: streak, points: state.points };
    state.adapter.send('tally', tally);
    applyTally(tally);

    // 大家都答完了就不必再等時間到——這是多人場最常見的空等。
    if (everyoneAnswered()) finishQuestion(index, null);
  }

  /** 搶答：第一個答對的人拿一分，這一題就結束。 */
  function arbitrateSteal(fromId, index, correct) {
    if (!correct) {
      // 答錯不結束這一題，只是這個人出局。廣播出去讓所有人看得到有人已經出手，
      // 現場才知道「還剩幾個人有機會」。
      state.adapter.send('strike', { index: index, id: fromId });
      renderStrike(fromId);

      // 所有人都答錯了，這一題不會有人搶到，不必讓大家乾等到十二秒。
      if (everyoneAnswered()) finishQuestion(index, null);
      return;
    }

    state.points[fromId] = (state.points[fromId] || 0) + 1;
    finishQuestion(index, fromId);
  }

  /** 房裡的人是不是都出手過了。 */
  function everyoneAnswered() {
    return state.players.every(function (person) {
      return state.claimed[person.id];
    });
  }

  /** 房主宣布這一題結束（有人搶到、大家都答完、或時間到）。 */
  function finishQuestion(index, winnerId) {
    if (!isHost() || state.resolved) return;
    state.resolved = true;

    state.adapter.send('award', { index: index, winnerId: winnerId, points: state.points });
    applyAward(index, winnerId, state.points);
  }

  /**
   * 有人得分了（競速／積分）。這一題還沒結束，所以只更新比分與提示，
   * 不揭曉正解——別人還在作答，提早揭曉等於送分。
   */
  function applyTally(tally) {
    if (tally.index !== state.index) return;

    state.points = tally.points || state.points;
    renderBoard();

    if (tally.id === state.adapter.selfId && tally.gained > 0) {
      el('play-hint').textContent = scoringOf() === 'combo'
        ? '答對！＋' + tally.gained + '（連對 ' + tally.streak + '）等其他人…'
        : '答對！＋' + tally.gained + '　等其他人…';
      el('play-hint').className = 'hint ok';
    }
  }

  /** 時間到了。只有房主會走到這裡——它是唯一有權宣布這一題結束的人。 */
  function arbitrateTimeout() {
    if (!isHost()) return;

    // 競速與積分：沒出手的人這一題連對歸零，否則「都不按」會保住倍率。
    if (!stealing()) {
      state.players.forEach(function (person) {
        if (!state.claimed[person.id]) state.streaks[person.id] = 0;
      });
    }

    finishQuestion(state.index, null);
  }

  function renderStrike(fromId) {
    if (fromId === state.adapter.selfId) return;
    var box = el('play-hint');
    if (box.className.indexOf('bad') !== -1) return; // 自己答錯的訊息比較重要，不要蓋掉
    box.textContent = nameOfPlayer(fromId) + ' 答錯了，還沒有人搶到。';
  }

  /**
   * 這一題結束。所有人（含房主）都走這一段，所以畫面與 Game 的推進完全同步。
   */
  function applyAward(index, winnerId, points) {
    if (index !== state.index) return;

    stopTimer();
    lockChoices();
    player.pause();

    state.locked = true;
    state.resolved = true;
    state.points = points || state.points;

    // 每題一律餵正解給 Game，而且是在這裡、所有人同一個時機餵。
    // 這是讓每台機器的 Game 走在同一步的另一半（另一半是同一顆種子）。
    state.game.answer(state.answerId);

    var correctButton = q('.choice[data-id="' + state.answerId + '"]');
    if (correctButton) correctButton.classList.add('correct');

    var box = el('verdict');
    var title = el('verdict-title');

    box.hidden = false;
    box.className = 'verdict ' + (winnerId ? (winnerId === state.adapter.selfId ? 'ok' : 'taken') : 'no');

    if (winnerId) {
      // 只有搶答會有「贏家」——另外兩種計分裡，答對的人各自拿各自的分。
      title.textContent = winnerId === state.adapter.selfId
        ? '你搶到了！＋1'
        : nameOfPlayer(winnerId) + ' 先答對，這一分被搶走了';
    } else if (stealing()) {
      title.textContent = '這一題沒有人搶到';
    } else {
      title.textContent = '這一題結束';
    }

    el('verdict-answer').textContent = '正解：' + state.answerLabel;
    renderBoard();

    if (!isHost()) return;

    /**
     * 一切自動推進，房主沒有「下一題」可以按。
     *
     * 一題會在三種情況結束（都不需要房主動手）：
     *   * 搶答模式：有人答對了。
     *   * 其他模式：所有人都答完了（everyoneAnswered）。
     *   * 時間到（arbitrateTimeout）。
     * 然後留 REVEAL_MS 給大家看正解，再自動接下一題。
     *
     * 原本還有一顆鈕給房主跳過這段等待。拿掉它是刻意的：現場實際玩的時候，
     * 那顆鈕只會讓房主變成全場的節拍器——大家還在看正解就被拉走，
     * 而房主自己也沒空一題一題按。
     */
    state.revealAt = Date.now() + REVEAL_MS;
    state.revealTimer = setTimeout(askNext, REVEAL_MS);
  }

  /**
   * 房主切到背景再切回來的時候補推一次。
   *
   * 少了那顆鈕之後，setTimeout 就是唯一的推進來源——而瀏覽器會把背景分頁的
   * 計時器節流到一分鐘一次（iOS 甚至整個暫停）。房主去看一下訊息回來，
   * 全場就卡在正解畫面上等他，而且沒有任何人能做什麼。
   */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (!isHost() || !state.game || !state.revealAt) return;
    if (Date.now() < state.revealAt) return;

    clearTimeout(state.revealTimer);
    askNext();
  });

  // ---- 計時條 ----

  function startTimer(seconds) {
    stopTimer();

    var bar = el('timer-bar');
    var text = el('timer-text');
    state.deadline = performance.now() + seconds * 1000;

    state.ticker = setInterval(function () {
      var left = Math.max(0, state.deadline - performance.now()) / 1000;
      bar.style.transform = 'scaleX(' + (left / seconds) + ')';
      text.textContent = left.toFixed(1);

      if (left === 0) {
        stopTimer();
        // 每個人的計時器各自從「收到 ask」起算，所以到期的時刻本來就不會完全一樣。
        // 只有房主的到期有效力，其他人到期就只是自己不能再答了。
        if (isHost()) arbitrateTimeout();
        else if (!state.locked) {
          state.locked = true;
          lockChoices();
          el('play-hint').textContent = '你這一題沒答，等房主宣布結果。';
        }
      }
    }, 50);
  }

  function stopTimer() {
    if (state.ticker) clearInterval(state.ticker);
    state.ticker = null;
  }

  // ---- 即時比分 ----

  function standings() {
    return state.players.map(function (person) {
      return { id: person.id, name: person.name, points: state.points[person.id] || 0 };
    }).sort(function (a, b) {
      // 同分就照暱稱排，至少每次重畫的順序是一樣的——名次會跳動比並列更難看。
      return b.points - a.points || a.name.localeCompare(b.name);
    });
  }

  /**
   * 比分板。人多的時候只列前幾名 ＋ 自己。
   *
   * 二十個人全列會變成一條要滑的清單，而遊戲進行中沒有人會去滑它——
   * 真正想知道的只有兩件事：誰在前面、我在第幾。
   */
  function renderBoard() {
    var box = el('board');
    box.replaceChildren();

    var rows = standings();
    var mine = rows.findIndex(function (row) { return row.id === state.adapter.selfId; });
    var shown = rows.slice(0, BOARD_ROWS);

    // 自己掉到看不見的地方就單獨接在後面（中間用一列點點表示省略了幾個人）。
    var hiddenBefore = 0;
    if (mine >= BOARD_ROWS) {
      hiddenBefore = mine - BOARD_ROWS;
      shown = shown.concat([null, rows[mine]]);
    }

    shown.forEach(function (row, at) {
      var item = document.createElement('li');

      if (row === null) {
        item.className = 'gap';
        item.textContent = hiddenBefore > 0 ? '⋯ 還有 ' + hiddenBefore + ' 人' : '⋯';
        box.append(item);
        return;
      }

      if (row.id === state.adapter.selfId) item.className = 'me';

      var place = document.createElement('i');
      place.className = 'place';
      place.textContent = (row === rows[mine] && at > BOARD_ROWS ? mine + 1 : at + 1) + '.';

      var who = document.createElement('span');
      who.textContent = row.name;

      var pts = document.createElement('b');
      pts.textContent = num(row.points) + Rules.roomScoreUnit(scoringOf());

      item.append(place, who, pts);
      box.append(item);
    });
  }

  // ---- 結算 ----

  function finishRound() {
    var rows = standings();
    state.adapter.send('over', { standings: rows });
    showResult(rows);

    // 這一場結束了，排隊的人可以進來了——他們的畫面會自己從「排隊中」
    // 變回等待室（收到 phase: 'waiting' 的名冊）。
    state.game = null;
    admitQueued();
  }

  function showResult(rows) {
    stopTimer();
    clearTimeout(state.revealTimer);
    player.pause();

    // 一場結束就別再抓了。留著的話，排隊中的下載會一路跑完（那些歌這一場
    // 已經用不到了），而且大家在結算頁討論比分的那幾分鐘裡，手上的 blob
    // 都還佔著記憶體。
    prefetch.drop();
    show('result');

    var top = rows[0];
    var tie = rows.length > 1 && rows[1].points === top.points;

    el('result-title').textContent = !top || top.points === 0
      ? (stealing() ? '沒有人搶到任何一題' : '沒有人拿到分數')
      : (tie ? '並列第一：' + rows.filter(function (r) {
          return r.points === top.points;
        }).map(function (r) {
          return r.name;
        }).join('、')
        : top.name + ' 拿下這一場');

    var total = rows.reduce(function (sum, r) {
      return sum + r.points;
    }, 0);

    // 搶答的分數就是題數，可以講「幾題有人搶到」；另外兩種是分數，那樣講會錯。
    el('result-note').textContent = stealing()
      ? '共 ' + state.totalQuestions + ' 題，' + total + ' 題有人搶到。'
      : '共 ' + state.totalQuestions + ' 題，全場一共拿了 ' + num(total) + ' 分。';

    var list = el('standings');
    list.replaceChildren();

    rows.forEach(function (row, i) {
      var item = document.createElement('li');
      if (row.id === state.adapter.selfId) item.className = 'me';

      var rank = document.createElement('i');
      rank.textContent = (i + 1);
      var who = document.createElement('span');
      who.textContent = row.name;
      var pts = document.createElement('b');
      pts.textContent = row.points + ' 題';

      item.append(rank, who, pts);
      list.append(item);
    });

    el('btn-again-room').hidden = !isHost();
  }

  el('btn-again-room').addEventListener('click', function () {
    if (!isHost()) return;

    // 換一顆種子，否則「再來一場」會是一模一樣的題目。
    state.settings.seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    beginRound();
  });

  el('btn-exit').addEventListener('click', leaveRoom);
  el('btn-leave').addEventListener('click', leaveRoom);

  function leaveRoom() {
    stopTimer();
    prefetch.drop();
    prefetch.hideWarm();
    clearTimeout(state.revealTimer);
    clearTimeout(state.joinTimer);
    clearTimeout(state.readyTimer);
    state.readyTimer = null;
    player.pause();

    if (state.adapter) {
      if (state.adapter.status === 'open') state.adapter.send('bye', {});
      state.adapter.close();
    }

    state.role = null;
    state.game = null;
    state.players = [];
    state.queued = [];

    // 「一個人開打要按兩次」的那個提醒也要跟著歸零，
    // 否則下一間房會在你還沒看到提醒之前就直接開打。
    soloConfirmed = false;
    el('btn-start-round').textContent = '開始';

    setNotice(picked.notice);
    show('lobby');
    lobbyError('');
  }

  // 關分頁的時候先說一聲，房主才不會在名冊上留一個永遠不會回來的人。
  window.addEventListener('beforeunload', function () {
    if (state.adapter && state.adapter.status === 'open') state.adapter.send('bye', {});
  });

  // ---- 收訊息 ----

  function handleMessage(message) {
    var payload = message.payload;

    switch (message.type) {
      case 'hello':
        if (!isHost()) return;
        admit(message.from, payload.name);
        return;

      case 'roster':
        if (isHost()) return; // 房主自己就是名冊的來源
        clearTimeout(state.joinTimer);

        state.hostId = payload.hostId;
        state.players = payload.players || [];
        state.settings = payload.settings;
        lobbyError('');

        // 已經在玩了就別把畫面拉回等待室——名冊是給比分板用的。
        if (!state.game) enterWaiting();
        else renderBoard();
        return;

      /**
       * 房主對某一個人的回覆：滿了、或者這一場正在進行中。
       *
       * **一定要點名。** 原本這兩種情況是用 roster 廣播回覆的，於是一個中途敲門的人
       * 會讓**全場**的非房主收到 phase: 'playing' 然後各自 leaveRoom()——
       * 一個人敲門，整場被踢出去。實際玩的時候就是這樣壞掉的。
       */
      case 'joinReply':
        if (isHost() || payload.to !== state.adapter.selfId) return;
        clearTimeout(state.joinTimer);

        if (payload.reason === 'full') {
          leaveRoom();
          return lobbyError('房號 ' + state.roomCode + ' 已經滿了（最多 ' + MAX_PLAYERS +
            ' 人）。請他們開第二間房，或等這一場打完。');
        }

        // 排隊中：**不要離開房間**。連線留著，這一場打完房主會把你放進名冊。
        state.hostId = payload.hostId;
        state.settings = payload.settings;
        state.players = payload.players || [];
        state.queued = payload.queued || [];
        lobbyError('');
        enterQueued(payload.ahead);
        return;

      case 'start':
        if (isHost()) return;
        startWithSettings(payload.settings);
        return;

      case 'ready':
        // 只有房主在等這個。
        if (isHost()) noteReady(message.from);
        return;

      case 'ask':
        if (isHost()) return;

        // 房主發題了＝預備時間結束，不管自己囤完沒有。
        prefetch.hideWarm('載入中…');

        var view = state.game && state.game.nextQuestion();
        if (!view) {
          setNotice('出不了題了（題庫和房主的不一致？）。這一場到這裡。');
          return;
        }

        beginQuestion(view);

        // 指紋不合就表示「大家在猜不同的題目」。這種錯不講出來，
        // 現場只會覺得「他怎麼都搶不到」，永遠查不到原因。
        if (payload.signature && payload.signature !== signatureOf(view)) {
          setNotice('警告：第 ' + state.index + ' 題和房主的不一樣（題庫或版本不同步）。' +
            '這一場的結果不算。');
        }
        return;

      case 'claim':
        arbitrate(message.from, payload.index, !!payload.correct, payload.elapsed);
        return;

      case 'tally':
        if (isHost()) return; // 房主是這則訊息的來源
        applyTally(payload);
        return;

      case 'strike':
        if (isHost()) return;
        if (payload.index === state.index) renderStrike(payload.id);
        return;

      case 'award':
        if (isHost()) return;
        applyAward(payload.index, payload.winnerId, payload.points);
        return;

      case 'over':
        if (isHost()) return;
        state.game = null;
        state.players = (payload.standings || []).map(function (row) {
          return { id: row.id, name: row.name };
        });
        showResult(payload.standings || []);
        return;

      case 'bye':
        state.queued = state.queued.filter(function (p) { return p.id !== message.from; });
        if (!isHost()) return;
        state.players = state.players.filter(function (p) {
          return p.id !== message.from;
        });
        if (!state.game) {
          renderPlayers();
          broadcastRoster('waiting');
        } else {
          renderBoard();
        }
        return;

      default:
        // 不認得的訊息一律忽略：以後加新訊息時，舊分頁不會因此壞掉。
        return;
    }
  }

  show('lobby');

  /**
   * 切到單人那一邊時要呼叫。
   *
   * 這裡是真的「離開房間」，不是只把畫面藏起來：連線要關、要跟房裡的人說一聲。
   * 留著一條半死的連線最糟——房主那邊的名冊上還有你，等你搶答，
   * 但你人已經在單人模式裡了。
   */
  /**
   * 標題後面那顆「?」。點開才看說明。
   *
   * 不用 <details>：說明要能被標題旁邊那個小符號控制，而 <details> 的觸發器
   * 是整條 <summary>，做出來會變成「整行標題可以點」——那條標題底下就是一排
   * 可以點的鈕，多一個看不出邊界的可點區域只會讓人誤觸。
   */
  var explainButtons = qa('.explain');
  for (var e = 0; e < explainButtons.length; e++) {
    explainButtons[e].addEventListener('click', function () {
      var box = document.getElementById(this.getAttribute('aria-controls'));
      if (!box) return;
      var open = box.hidden;
      box.hidden = !open;
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  window.RoomShell = {

    stop: function () {
      if (state.role) leaveRoom();
      else show('lobby');
    },
    /** 設定面板要知道現在該不該給「離開房間」這個選項。 */
    inRoom: function () {
      return !!state.role;
    },
    leave: function () {
      if (state.role) leaveRoom();
      else show('lobby');
    },
  };

})();
