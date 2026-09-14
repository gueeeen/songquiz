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
})();
