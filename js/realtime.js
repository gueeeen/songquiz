// 即時層。房間邏輯（room.js）只認得下面這一組介面，
// 不認得 Supabase、不認得 BroadcastChannel、也不認得區域網路中繼——多一條路就多寫一個 adapter。
//
// 介面（三個 adapter 完全共用）：
//
//   adapter.selfId              這個節點的身分（房間用它認人）
//   adapter.label               給人看的通道名稱，畫面要說清楚現在走的是哪一條線
//   adapter.crossDevice         這條線能不能跨裝置（false ＝ 只有同一台電腦）
//   adapter.connect(roomCode)   → Promise<void>，連上才 resolve
//   adapter.send(type, payload) 廣播一則訊息
//   adapter.close()
//   adapter.onMessage(fn)       fn({ type, payload, from })
//   adapter.onStatus(fn)        fn(status, detail)；status ∈ idle/connecting/open/closed/error
//
// **send 不會把訊息回送給自己。** 這不是省事，是兩家的預設行為本來就一致：
// BroadcastChannel 規格上就不派送給發送端，Supabase Realtime 的 broadcast
// 預設 self: false。既然兩邊一樣，就把它寫進介面契約——呼叫端自己先套用自己的動作，
// 這樣「本機立刻有反應」和「遠端收到訊息」走的是同一段程式碼路徑。

(function () {
  'use strict';

  /** 協定版本。兩邊版本不同時寧可丟掉訊息，也不要用錯的欄位名去猜對方的意思。 */
  var PROTOCOL = 1;

  /**
   * CDN 網址刻意鎖死小版號，不用 @2 這種浮動範圍。
   * 浮動範圍等於「上游哪天改了，我們的房間就在客人面前壞掉」，
   * 而這個站沒有 CI、沒有打包步驟，壞了不會有人先發現。
   *
   * 2.116.0 的 package.json 把 jsdelivr／unpkg 入口指向 dist/umd/supabase.js，
   * 那個檔是傳統 script（開頭就是 var supabase=(function(e){…），載入後掛在
   * window.supabase 上）——正是這個站需要的形式，不是 ES module。
   */
  var SUPABASE_UMD = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js';

  /** 房號的字母表：拿掉 0/O/1/I/L，這幾個唸出來會聽錯、看著也會打錯。 */
  var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  var CODE_LENGTH = 4;

  function randomInt(bound) {
    // 房號不是密碼，但用 crypto 就不必擔心「同一秒建兩間房撞號」。
    if (window.crypto && window.crypto.getRandomValues) {
      var buffer = new Uint32Array(1);
      window.crypto.getRandomValues(buffer);
      return buffer[0] % bound;
    }
    return Math.floor(Math.random() * bound);
  }

  function makeRoomCode() {
    var code = '';
    for (var i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length));
    return code;
  }

  /**
   * 把人手打的房號整理成標準形式。
   * 大小寫一律轉大寫，不在字母表裡的字元（空白、連字號、看成 0 的 O）直接丟掉——
   * 房號是要在吵雜的現場喊給別人聽的，容錯比嚴格好。
   */
  function normalizeRoomCode(text) {
    var upper = String(text || '').toUpperCase();
    var out = '';

    for (var i = 0; i < upper.length; i++) {
      var ch = upper.charAt(i);
      // 字母表裡沒有的字元一律丟掉，不要試著「猜他想打什麼」。
      // O 可能是 0 也可能真的是 O，猜錯會讓他連到別人的房間，比打不進去更糟。
      if (CODE_ALPHABET.indexOf(ch) !== -1) out += ch;
    }

    return out.slice(0, CODE_LENGTH);
  }

  function randomId() {
    return 'p' + randomInt(0x7fffffff).toString(36) + randomInt(0x7fffffff).toString(36);
  }

  function topicFor(roomCode) {
    return 'songquiz-room-' + roomCode;
  }

  // ---- 共用的殼 ----
  // 身分、訊息封包、listener 管理都在這裡。子類別只要實作三件事：
  // _open(roomCode) → Promise、_sendRaw(envelope)、_close()。

  function BaseAdapter() {
    this.selfId = randomId();
    this.roomCode = '';
    this.status = 'idle';
    this._onMessage = [];
    this._onStatus = [];
  }

  BaseAdapter.prototype.onMessage = function (fn) {
    this._onMessage.push(fn);
  };

  BaseAdapter.prototype.onStatus = function (fn) {
    this._onStatus.push(fn);
  };

  BaseAdapter.prototype._setStatus = function (status, detail) {
    this.status = status;
    this._onStatus.forEach(function (fn) {
      fn(status, detail);
    });
  };

  BaseAdapter.prototype.connect = function (roomCode) {
    var self = this;
    this.roomCode = roomCode;
    this._setStatus('connecting');

    return this._open(roomCode).then(function () {
      self._setStatus('open');
    }, function (error) {
      self._setStatus('error', error && error.message ? error.message : String(error));
      throw error;
    });
  };

  BaseAdapter.prototype.send = function (type, payload) {
    if (this.status !== 'open') return false;
    this._sendRaw({ protocol: PROTOCOL, type: type, from: this.selfId, payload: payload || {} });
  };

  /**
   * 只給某一個人的訊息。
   *
   * 通道本身是廣播的，所以「點名」是在信封上寫收件人、由收件端過濾。
   * **這件事一定要在這一層做**：放在 payload 裡讓每個 case 自己檢查的話，
   * 漏檢一個就會變成「一則回覆波及全場」——房間就是這樣壞過一次
   * （中途一個人敲門，全場被踢出遊戲）。
   */
  BaseAdapter.prototype.sendTo = function (id, type, payload) {
    this._sendRaw({
      protocol: PROTOCOL, type: type, from: this.selfId, to: id, payload: payload || {},
    });
    return true;
  };

  BaseAdapter.prototype.close = function () {
    if (this.status === 'idle' || this.status === 'closed') return;
    try {
      this._close();
    } catch (e) {
      // 關的時候出錯沒有下一步可做，不要讓它蓋掉真正要處理的事情。
    }
    this._setStatus('closed');
  };

  /** 收到一則訊息。不認得的協定版本、或自己發的（理論上不會）一律丟掉。 */
  BaseAdapter.prototype._receive = function (envelope) {
    if (!envelope || envelope.protocol !== PROTOCOL) return;
    if (envelope.from === this.selfId) return;

    // 點名的訊息（sendTo）只給收件人。和上面兩道是同一類判斷：
    // 「這則訊息不是要給我處理的」。
    if (envelope.to && envelope.to !== this.selfId) return;

    var message = { type: envelope.type, payload: envelope.payload || {}, from: envelope.from };
    this._onMessage.forEach(function (fn) {
      fn(message);
    });
  };

  // ---- BroadcastChannel ----
  // 瀏覽器內建，不需要任何帳號，同一台電腦的多個分頁之間就能玩。
  // 這是這個功能唯一能在「沒有服務金鑰」的情況下端到端驗證的路徑，
  // 所以它不是玩具：它是這個房間協定的固定測試工具。

  function BroadcastChannelAdapter() {
    BaseAdapter.call(this);
    this.label = '同機測試（BroadcastChannel）';
    this.crossDevice = false;
    this._channel = null;
  }

  BroadcastChannelAdapter.prototype = Object.create(BaseAdapter.prototype);
  BroadcastChannelAdapter.prototype.constructor = BroadcastChannelAdapter;

  BroadcastChannelAdapter.available = function () {
    return typeof window.BroadcastChannel === 'function';
  };

  BroadcastChannelAdapter.prototype._open = function (roomCode) {
    var self = this;

    if (!BroadcastChannelAdapter.available()) {
      return Promise.reject(new Error('這個瀏覽器沒有 BroadcastChannel。'));
    }

    this._channel = new window.BroadcastChannel(topicFor(roomCode));
    this._channel.onmessage = function (event) {
      self._receive(event.data);
    };

    // BroadcastChannel 沒有「連線」這個概念，建構完就已經通了。
    return Promise.resolve();
  };

  BroadcastChannelAdapter.prototype._sendRaw = function (envelope) {
    this._channel.postMessage(envelope);
  };

  BroadcastChannelAdapter.prototype._close = function () {
    if (!this._channel) return;
    this._channel.onmessage = null;
    this._channel.close();
    this._channel = null;
  };

  // ---- Supabase Realtime Broadcast ----
  // 真正跨裝置的那一條。用的是 broadcast（純訊息轉送），不建任何資料表、
  // 不寫任何一列資料——房間是一場對話，不是一筆記錄，結束就該什麼都不留。

  var supabaseSdk = null;

  /**
   * 把 UMD bundle 動態插進頁面。
   *
   * 為什麼不寫死在 room.html 的 <script> 裡：那 218 KB 對「只想用同機測試」
   * 或「根本還沒設定」的人是白付的成本。設定了才載，是這個檔唯一該做的判斷。
   */
  function loadSupabaseSdk() {
    if (supabaseSdk) return supabaseSdk;

    supabaseSdk = new Promise(function (resolve, reject) {
      if (window.supabase && window.supabase.createClient) return resolve(window.supabase);

      var tag = document.createElement('script');
      tag.src = SUPABASE_UMD;
      tag.async = true;
      tag.onload = function () {
        if (window.supabase && window.supabase.createClient) resolve(window.supabase);
        else reject(new Error('SDK 載進來了但沒有 createClient，版本可能不對。'));
      };
      tag.onerror = function () {
        reject(new Error('載不到 Supabase SDK（檢查網路，或這一頁是不是從 file:// 開的）。'));
      };
      document.head.appendChild(tag);
    });

    return supabaseSdk;
  }

  function SupabaseAdapter(config) {
    BaseAdapter.call(this);
    this.label = 'Supabase Realtime';
    this.crossDevice = true;
    this._url = config.url;
    this._key = config.anonKey;
    this._client = null;
    this._channel = null;
  }

  SupabaseAdapter.prototype = Object.create(BaseAdapter.prototype);
  SupabaseAdapter.prototype.constructor = SupabaseAdapter;

  SupabaseAdapter.prototype._open = function (roomCode) {
    var self = this;

    return loadSupabaseSdk().then(function (sdk) {
      return new Promise(function (resolve, reject) {
        // 不登入、不註冊。Realtime 的「Allow public access to channels」預設是開著的，
        // 拿 publishable／anon key 就能訂閱與廣播 public channel，
        // 不需要 session、不需要 RLS 政策、不需要任何資料表。
        // （房主哪天在 Realtime Settings 關掉這個開關，就得改用 private channel
        //   ＋ realtime.messages 的 RLS 政策，那時玩家就得先有身分了。）
        self._client = sdk.createClient(self._url, self._key, {
          auth: { persistSession: false, autoRefreshToken: false },
          realtime: { params: { eventsPerSecond: 20 } },
        });

        self._channel = self._client.channel(topicFor(roomCode), {
          config: { broadcast: { self: false } },
        });

        // 所有房間訊息走同一個 event 名稱，type 在封包裡。
        // 一個 event 一個 on() 的話，每加一種訊息就要記得多註冊一次，遲早會漏。
        self._channel.on('broadcast', { event: 'room' }, function (message) {
          self._receive(message && message.payload);
        });

        var settled = false;

        self._channel.subscribe(function (status, error) {
          if (status === 'SUBSCRIBED') {
            settled = true;
            return resolve();
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // 連上之後才掉線的話，reject 已經來不及了——改用 status 通報畫面。
            if (settled) return self._setStatus('error', status);
            settled = true;
            reject(new Error('連不上 Supabase Realtime（' + status +
              (error && error.message ? '：' + error.message : '') + '）'));
          }
        });
      });
    });
  };

  SupabaseAdapter.prototype._sendRaw = function (envelope) {
    this._channel.send({ type: 'broadcast', event: 'room', payload: envelope });
  };

  SupabaseAdapter.prototype._close = function () {
    if (this._channel && this._client) this._client.removeChannel(this._channel);
    this._channel = null;
    this._client = null;
  };

  // ---- 區域網路中繼 ----
  // 第三條路，也是最省事的一條：用主辦人自己那台電腦當中繼
  // （tools\SongQuiz.LanServer，雙擊「區域網路開房.cmd」啟動）。
  //
  // 為什麼要有它：Supabase 那條路要註冊帳號、抄金鑰、還得把網站放到 https 上。
  // 但真實情境是「朋友在同一個場地、同一個 Wi-Fi」——那根本不需要外部服務。
  // 這條路零帳號、零設定、零費用，而且不必連外網。
  //
  // **不寫死任何 IP。** 這一頁本來就是從那台伺服器載來的，所以伺服器位址
  // 就是網址本身（location.host）。這也正是這條路不需要設定檔的原因：
  // 要設定什麼，瀏覽器早就知道了。

  /** 探測中繼的等待上限。同一個 Wi-Fi 的一趟來回是幾毫秒，兩秒沒回就是沒有。 */
  var PROBE_TIMEOUT_MS = 2000;

  /** 探測結果：null ＝ 還沒問到答案、true／false ＝ 問過了。 */
  var relayAvailable = null;

  /** 探測只做一次，結果給所有呼叫端共用。 */
  var relayProbe = null;

  function pageIsHosted() {
    var scheme = window.location.protocol;
    return scheme === 'http:' || scheme === 'https:';
  }

  /**
   * 這一頁的來源有沒有中繼？
   *
   * 為什麼不能只看「網頁是不是從 http(s) 載來的」：放在 GitHub Pages 上的同一份檔案
   * 也是 https，但那邊只有靜態檔，沒有 /ws。所以要真的問一句。
   *
   * 為什麼是打 /api/ping 而不是直接開 WebSocket 再退讓：握手失敗要等到 TCP 逾時，
   * 那可能是好幾秒的白畫面；而且「WebSocket 連不上」和「這裡根本不是我們的伺服器」
   * 分不出來，後者不該在畫面上顯示成連線錯誤。
   *
   * @returns {Promise<boolean>} 一定 resolve，不會 reject——探測失敗就是「沒有」。
   */
  function probeRelay() {
    if (relayProbe) return relayProbe;

    // file:// 雙擊開的話連問都不必問：沒有來源可以問。
    if (!pageIsHosted() || typeof window.fetch !== 'function' || typeof window.WebSocket !== 'function') {
      relayAvailable = false;
      relayProbe = Promise.resolve(false);
      return relayProbe;
    }

    relayProbe = new Promise(function (resolve) {
      var settled = false;

      function settle(value) {
        if (settled) return;
        settled = true;
        relayAvailable = value;
        resolve(value);
      }

      // fetch 沒有內建逾時，自己補一個。沒有的話，遇到一個「收下連線但不回話」的
      // 中介（公司的 proxy、某些飯店 Wi-Fi），這一頁會卡在探測上不動。
      var timer = window.setTimeout(function () {
        settle(false);
      }, PROBE_TIMEOUT_MS);

      // 相對路徑：網站可能被放在子目錄底下（GitHub Pages 的 repo 頁面就是）。
      window.fetch('api/ping', { cache: 'no-store' }).then(function (response) {
        return response.ok ? response.json() : null;
      }).then(function (body) {
        window.clearTimeout(timer);
        // 只認自己的招牌，不看狀態碼。很多靜態空間找不到檔案時會回 200 加一頁 HTML
        // （SPA 的回退規則），光看 response.ok 會把那種空間誤判成中繼。
        settle(!!(body && body.service === 'songquiz-lan' && body.relay === true));
      }, function () {
        window.clearTimeout(timer);
        settle(false);
      });
    });

    return relayProbe;
  }

  /**
   * 中繼的 WebSocket 位址。
   * 從當前網址推出來——不是設定、不是猜的：這一頁就是那台伺服器送來的。
   * 路徑保留目錄部分（網站可能在子目錄），https 的頁面要用 wss（不然會被當混合內容擋掉）。
   */
  function lanSocketUrl(roomCode) {
    var scheme = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    var directory = window.location.pathname.replace(/[^/]*$/, '');
    return scheme + window.location.host + directory + 'ws?room=' + encodeURIComponent(roomCode);
  }

  function LanAdapter() {
    BaseAdapter.call(this);
    this.label = '區域網路中繼（' + window.location.host + '）';
    this.crossDevice = true;
    this._socket = null;
  }

  LanAdapter.prototype = Object.create(BaseAdapter.prototype);
  LanAdapter.prototype.constructor = LanAdapter;

  LanAdapter.prototype._open = function (roomCode) {
    var self = this;

    return probeRelay().then(function (ok) {
      if (!ok) {
        throw new Error('這個網址沒有中繼。要跨裝置玩的話，請從「區域網路開房.cmd」' +
          '啟動的那個網址開這一頁。');
      }

      return new Promise(function (resolve, reject) {
        var socket = new window.WebSocket(lanSocketUrl(roomCode));
        var settled = false;

        self._socket = socket;

        socket.onopen = function () {
          settled = true;
          resolve();
        };

        socket.onmessage = function (event) {
          var envelope = null;

          try {
            envelope = JSON.parse(event.data);
          } catch (e) {
            // 剖不出來的就丟掉。中繼是原封不動轉送的，所以壞封包只可能來自
            // 版本不合的對方——猜他的意思比丟掉更糟。
            return;
          }

          self._receive(envelope);
        };

        socket.onerror = function () {
          if (settled) return;
          settled = true;
          reject(new Error('連不上這台電腦的中繼（伺服器那個視窗還開著嗎？）'));
        };

        socket.onclose = function (event) {
          if (!settled) {
            settled = true;
            return reject(new Error('中繼把連線關掉了（代碼 ' + event.code + '）。'));
          }

          // 連上之後才掉線的話 reject 已經來不及了——照介面契約用 status 通報畫面。
          // （自己呼叫 close() 的情況走不到這裡：_close 會先把 onclose 拆掉。）
          if (self.status === 'open') {
            self._setStatus('error', '和中繼斷線了（伺服器那個視窗是不是關掉了？）');
          }
        };
      });
    });
  };

  LanAdapter.prototype._sendRaw = function (envelope) {
    if (!this._socket || this._socket.readyState !== window.WebSocket.OPEN) return;
    this._socket.send(JSON.stringify(envelope));
  };

  LanAdapter.prototype._close = function () {
    if (!this._socket) return;

    var socket = this._socket;
    this._socket = null;

    // 先拆掉 onclose 再關：自己主動關的不是「斷線」，不該在畫面上報成錯誤。
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close();
  };

  // ---- 挑一個 adapter ----

  /**
   * 挑一條線，並且一定回得出東西來。優先順序：
   *
   *   1. 網址的 ?rt=… ——測試後門，最大。要能指定走哪一條，不受環境與設定檔影響。
   *   2. 這一頁是從 http(s) 載來的、而且那台伺服器有中繼 → LanAdapter。
   *      排在設定檔前面是因為這條路**不需要任何設定**：網址就是伺服器位址。
   *      既然人已經從那台伺服器把這一頁打開了，他要的顯然就是那台伺服器。
   *   3. realtime-config.js 設了 supabase 且金鑰齊全 → SupabaseAdapter。
   *   4. 其餘（file:// 雙擊開、或什麼都沒設）→ BroadcastChannel。
   *
   * 「金鑰還沒填」是預期中的狀態，不是錯誤：這時候退回 BroadcastChannel，
   * 讓人至少能在同一台電腦上玩完一場，同時把 notice 交給畫面去說明白。
   * 白畫面或丟例外是最糟的處理方式——玩的人不知道自己該去設定什麼。
   *
   * **畫面上沒有「選一條線」的開關，這是刻意的。** 區域網路這條路的全部價值
   * 就在於不必設定；多一個下拉選單就等於把設定又還給使用者了。
   *
   * @param {string} [force] 'broadcast'｜'supabase'｜'lan'，用來蓋掉自動判斷（測試工具用）
   * @returns {{adapter: Object, notice: string}}
   */
  function pick(force) {
    var config = window.REALTIME_CONFIG || {};
    var notice = '';

    if (force === 'lan') return { adapter: new LanAdapter(), notice: '' };
    if (force !== 'broadcast' && force !== 'supabase') force = null;

    // 只有「探測確定回答有中繼」才走區域網路，不能因為「還沒回答」就先當成有。
    //
    // 這一條踩過：頁面一載入就 pick() 一次來顯示線路名稱，那時探測還在飛，
    // 寫成 relayAvailable !== false 的話，GitHub Pages 上會顯示「區域網路中繼
    // （xxx.github.io）」——騙人，而且若有人在探測回來前就按下建房，
    // LanAdapter._open 會據實丟出「這個網址沒有中繼」，而不是改走 Supabase。
    //
    // 代價是探測回來之前的那一瞬間會先顯示別條線的名稱。呼叫端要的話可以用
    // Realtime.relayReady() 等探測結束再問一次（room.js 就是這樣更新那行字的）。
    if (!force && relayAvailable === true) {
      return { adapter: new LanAdapter(), notice: '' };
    }

    var provider = force || config.provider || 'none';

    if (provider === 'supabase') {
      if (config.url && config.anonKey) {
        return { adapter: new SupabaseAdapter(config), notice: '' };
      }
      notice = '多人連線還沒設定：realtime-config.js 的 provider 是 supabase，' +
        '但 url／anonKey 是空的。現在退回同一台電腦的測試通道。';
    } else if (provider !== 'broadcast') {
      // 先講區域網路那一條：它不必註冊、不必抄金鑰，而且朋友多半就在旁邊。
      notice = '現在只能在同一台電腦的多個分頁之間玩。要讓朋友用自己的手機加入，' +
        '最快的做法是在這台電腦上雙擊「區域網路開房.cmd」，再用它印出來的網址開這一頁' +
        '（不需要任何帳號）。跨網路（不同場地）才需要設定 realtime-config.js，' +
        '步驟看「多人房間.md」。';
    }

    if (!BroadcastChannelAdapter.available()) {
      return {
        adapter: null,
        notice: (notice ? notice + ' ' : '') +
          '而這個瀏覽器連 BroadcastChannel 都沒有，多人房間無法使用。',
      };
    }

    return { adapter: new BroadcastChannelAdapter(), notice: notice };
  }

  // 探測要趁早發動：pick() 是同步的（room.js 一載入就呼叫），
  // 而「這個來源有沒有中繼」只能用非同步的方式問。現在就問，
  // 等到有人真的按下「建立房間」時答案早就回來了。
  probeRelay();

  window.Realtime = {
    PROTOCOL: PROTOCOL,
    SUPABASE_UMD: SUPABASE_UMD,
    CODE_LENGTH: CODE_LENGTH,
    makeRoomCode: makeRoomCode,
    normalizeRoomCode: normalizeRoomCode,
    BroadcastChannelAdapter: BroadcastChannelAdapter,
    SupabaseAdapter: SupabaseAdapter,
    LanAdapter: LanAdapter,
    /** 中繼探測的結果，給測試與診斷用。一定 resolve。 */
    relayReady: probeRelay,
    pick: pick,
  };
})();
