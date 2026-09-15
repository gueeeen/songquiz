// 「一個人玩」和「和朋友一起」住在同一頁，這個檔負責切換。
//
// 它只做三件事：顯示哪一半、叫另一半停下來、把選擇記在網址的 hash 裡。
// 遊戲本身它一概不碰——app.js 與 room.js 各自完整，這裡只是開關。

(function () {
  'use strict';

  var panes = {
    solo: document.getElementById('solo-app'),
    room: document.getElementById('room-app'),
  };

  var current = null;

  function apply(mode) {
    if (mode !== 'room') mode = 'solo';
    if (mode === current) return;

    // 先叫要離開的那一半停下來，再換畫面。
    // 藏起來不等於停下來：計時器、音訊、自動跳下一題都還會繼續跑，
    // 而且會在使用者已經在看另一邊的時候發生。
    if (current === 'solo' && window.SoloShell) window.SoloShell.stop();
    if (current === 'room' && window.RoomShell) window.RoomShell.stop();

    panes.solo.hidden = mode !== 'solo';
    panes.room.hidden = mode !== 'room';
    current = mode;

    // 那條釘在底部的開始鈕只存在於單人首頁。離開單人的時候 SoloShell.stop()
    // 會把單人這半帶回首頁，所以「在單人」就等於「首頁」；多人這半沒有它。
    document.body.classList.toggle('has-dock', mode === 'solo');


    // 兩邊的切換鈕都要跟著標，否則切過去之後看不出自己在哪一邊。
    var picks = document.querySelectorAll('.who-pick[data-who]');
    for (var i = 0; i < picks.length; i++) {
      if (picks[i].dataset.who === mode) picks[i].setAttribute('aria-current', 'page');
      else picks[i].removeAttribute('aria-current');
    }

    // 記在 hash 裡：重新整理會回到同一邊，而且 #room 這個網址可以直接丟給朋友。
    //
    // **但 file:// 不能碰網址。** 實測（web/tests 之外，用兩個 iframe 驗過）：
    // 從 file:// 開的頁面一旦用 replaceState 改過網址，它的 BroadcastChannel
    // 就和沒改過的頁面斷開，訊息完全不通——雙擊開啟的多分頁同機對戰會直接壞掉，
    // 而且畫面上兩邊都顯示「已連線」，是最難查的那種壞法。
    // file:// 沒有真正的來源，Chrome 用文件網址當替代，改網址等於換了一個身分。
    //
    // 從網站（http/https）開就沒這個問題，那裡的來源是真的來源，hash 不影響。
    if (window.location.protocol !== 'file:') {
      var hash = mode === 'room' ? '#room' : '';
      if (window.location.hash !== hash) {
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search + hash);
        } else {
          window.location.hash = hash;
        }
      }
    }

    window.scrollTo(0, 0);
  }

  var picks = document.querySelectorAll('.who-pick[data-who]');
  for (var i = 0; i < picks.length; i++) {
    picks[i].addEventListener('click', function () {
      apply(this.dataset.who);
    });
  }

  // 舊的 room.html 會轉址到 index.html#room，所以開場要看 hash。
  window.addEventListener('hashchange', function () {
    apply(window.location.hash === '#room' ? 'room' : 'solo');
  });

  apply(window.location.hash === '#room' ? 'room' : 'solo');

  // ------------------------------------------------------------ 設定面板

  //
  // 接線放在這裡而不是 app.js／room.js：面板上的「回到主畫面」與「離開房間」
  // 要同時認得單人和多人這兩半，而這個檔是唯一認得的。
  // 面板本身在 index.html，兩邊共用同一份——音量開兩個滑桿就要同步兩份狀態，
  // 而那種東西一定會分岔。

  var gear = document.getElementById('btn-settings');
  var sheet = document.getElementById('settings');
  var leaveButton = document.getElementById('btn-settings-leave');

  function openSheet() {
    // 多人只有真的在房裡才給「離開房間」；在大廳按它沒有意義。
    leaveButton.hidden = !(current === 'room' && window.RoomShell && window.RoomShell.inRoom());
    sheet.hidden = false;
    gear.setAttribute('aria-expanded', 'true');
    document.getElementById('btn-settings-close').focus();
  }

  function closeSheet() {
    sheet.hidden = true;
    gear.setAttribute('aria-expanded', 'false');
    gear.focus();
  }

  gear.addEventListener('click', function () {
    if (sheet.hidden) openSheet();
    else closeSheet();
  });

  document.getElementById('btn-settings-close').addEventListener('click', closeSheet);

  // 點背景關掉。判斷 target 是不是遮罩本身，否則點面板內部也會關。
  sheet.addEventListener('click', function (event) {
    if (event.target === sheet) closeSheet();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !sheet.hidden) closeSheet();
  });

  document.getElementById('btn-settings-feedback').addEventListener('click', function () {
    closeSheet();
    if (window.FeedbackUI) window.FeedbackUI.open();
  });


  document.getElementById('btn-settings-home').addEventListener('click', function () {

    // 「回到主畫面」＝結束手上這一局回到設定畫面。兩邊各自的 stop() 已經做完
    // 該收的事（計時器、音訊、自動跳題），這裡只要挑對呼叫誰。
    if (current === 'room' && window.RoomShell) window.RoomShell.stop();
    else if (window.SoloShell) window.SoloShell.stop();
    closeSheet();
  });

  leaveButton.addEventListener('click', function () {
    if (window.RoomShell) window.RoomShell.leave();
    closeSheet();
  });

  // ------------------------------------------------------------ 日間／夜間
  //
  // 三段：跟隨系統／日間／夜間。預設跟隨系統，因為多數人已經在作業系統上
  // 表達過偏好了，再問一次是多餘的。選了就記住，換頁不會跑掉。

  var THEME_KEY = 'songquiz.theme';
  var themePick = document.getElementById('theme-pick');

  function applyTheme(choice) {
    if (choice !== 'light' && choice !== 'dark') choice = 'auto';

    // auto 就把屬性拿掉，讓 CSS 裡的 prefers-color-scheme 自己決定。
    if (choice === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', choice);

    var buttons = themePick.querySelectorAll('[data-theme]');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].dataset.theme === choice) buttons[i].setAttribute('aria-current', 'page');
      else buttons[i].removeAttribute('aria-current');
    }

    try {
      window.localStorage.setItem(THEME_KEY, choice);
    } catch (error) {
      // 無痕視窗會擋 localStorage。記不起來就算了，這一次的選擇仍然有效。
    }
  }

  var themeButtons = themePick.querySelectorAll('[data-theme]');
  for (var t = 0; t < themeButtons.length; t++) {
    themeButtons[t].addEventListener('click', function () {
      applyTheme(this.dataset.theme);
    });
  }

  var saved = null;
  try {
    saved = window.localStorage.getItem(THEME_KEY);
  } catch (error) {
    saved = null;
  }
  applyTheme(saved || 'auto');
})();
