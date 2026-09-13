// 即時層。房間邏輯（room.js）只認得下面這一組介面，
// 不認得 Supabase、也不認得 BroadcastChannel——換一家服務只要多寫一個 adapter。
//
// 介面（兩個 adapter 完全共用）：
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

  // ---- 挑一個 adapter ----

  /**
   * 依 realtime-config.js 決定走哪一條線，並且一定回得出東西來。
   *
   * 「金鑰還沒填」是預期中的狀態，不是錯誤：這時候退回 BroadcastChannel，
   * 讓人至少能在同一台電腦上玩完一場，同時把 notice 交給畫面去說明白。
   * 白畫面或丟例外是最糟的處理方式——玩的人不知道自己該去設定什麼。
   *
   * @param {string} [force] 'broadcast'｜'supabase'，用來蓋掉設定檔（測試工具用）
   * @returns {{adapter: Object, notice: string}}
   */
  function pick(force) {
    var config = window.REALTIME_CONFIG || {};
    var provider = force || config.provider || 'none';
    var notice = '';

    if (provider === 'supabase') {
      if (config.url && config.anonKey) {
        return { adapter: new SupabaseAdapter(config), notice: '' };
      }
      notice = '多人連線還沒設定：realtime-config.js 的 provider 是 supabase，' +
        '但 url／anonKey 是空的。現在退回同一台電腦的測試通道。';
    } else if (provider !== 'broadcast') {
      notice = '多人連線還沒設定（realtime-config.js 的 provider 還是 none），' +
        '現在只能在同一台電腦的多個分頁之間玩。跨裝置的設定步驟看「多人房間.md」。';
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

  window.Realtime = {
    PROTOCOL: PROTOCOL,
    SUPABASE_UMD: SUPABASE_UMD,
    CODE_LENGTH: CODE_LENGTH,
    makeRoomCode: makeRoomCode,
    normalizeRoomCode: normalizeRoomCode,
    BroadcastChannelAdapter: BroadcastChannelAdapter,
    SupabaseAdapter: SupabaseAdapter,
    pick: pick,
  };
})();
