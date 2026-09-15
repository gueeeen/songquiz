// 意見箱的畫面層。
//
// 只有一份表單，而且只問兩件事：整體幾顆星、一句話。
// 入口有三個（左下角的信箱、設定面板、結算頁那一行），但打開的都是同一個彈窗——
// 同樣的問題出現在好幾個地方各一份的話，人會不確定自己是不是已經送過了。
//
// 更細的問題（分項滿意度、想看到什麼功能）走站外的表單，網址填在
// realtime-config.js 的 FEEDBACK_FORM_URL。沒填就不會出現那個連結。
//
// 送出本身在 feedback.js，這裡不碰網路。

(function () {
  'use strict';

  var Feedback = window.Feedback;

  function el(id) {
    return document.getElementById(id);
  }

  var STARS = 5;

  var sheet = el('feedback');
  var mail = el('btn-mail');
  var note = el('fb-note');
  var sendButton = el('btn-fb-send');
  var state = el('fb-state');

  /**
   * 五顆星。
   *
   * 用 button 而不是 input[type=radio]：已經選了三分再點第三顆要能取消。
   * 那是「我不想回答」，和「給三分」不是同一件事——送出的時候前者根本不會送。
   */
  var value = 0;
  var buttons = [];

  (function build() {
    var host = el('fb-stars');
    host.replaceChildren();

    for (var i = 1; i <= STARS; i++) {
      (function (score) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'star';
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', 'false');
        button.setAttribute('aria-label', score + ' 顆星');
        button.textContent = '★';
        button.addEventListener('click', function () {
          setStars(score === value ? 0 : score);
        });
        buttons.push(button);
        host.append(button);
      })(i);
    }
  })();

  function setStars(next) {
    value = next;
    buttons.forEach(function (button, index) {
      button.classList.toggle('on', index < value);
      button.setAttribute('aria-checked', index + 1 === value ? 'true' : 'false');
    });
    sendButton.disabled = value === 0 || !Feedback.available();
  }

  // ------------------------------------------------------------ 開關

  function open() {
    sheet.hidden = false;
    mail.setAttribute('aria-expanded', 'true');
    el('btn-fb-close').focus();
  }

  function close() {
    sheet.hidden = true;
    mail.setAttribute('aria-expanded', 'false');
  }

  mail.addEventListener('click', function () {
    if (sheet.hidden) open();
    else close();
  });

  el('btn-fb-close').addEventListener('click', close);
  el('btn-rate-open').addEventListener('click', open);

  // 點背景關掉。判斷 target 是不是遮罩本身，否則點表單內部也會關。
  sheet.addEventListener('click', function (event) {
    if (event.target === sheet) close();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !sheet.hidden) close();
  });

  // ------------------------------------------------------------ 送出

  sendButton.addEventListener('click', function () {
    sendButton.disabled = true;
    state.className = 'fb-state';
    state.textContent = '送出中…';

    Feedback.send({ stars: value, note: note.value }).then(function () {
      // 送完把表單收起來換成一句話。留著表單會讓人以為沒送出去，然後再送一次。
      el('fb-stars').parentNode.hidden = true;
      note.parentNode.hidden = true;
      el('btn-fb-send').parentNode.hidden = true;
      state.className = 'fb-state ok';
      state.textContent = '收到了，謝謝。';
    }).catch(function (error) {
      sendButton.disabled = false;
      state.className = 'fb-state bad';
      state.textContent = '送不出去：' + error.message;
    });
  });

  // ------------------------------------------------------------ 站外的完整表單

  (function externalForm() {
    var url = window.FEEDBACK_FORM_URL;
    if (!url) return;

    var link = el('fb-more');
    link.href = url;
    link.hidden = false;
  })();

  // 沒設定 Supabase 的時候（例如直接用 file:// 打開）就先講清楚，
  // 而不是讓人填完才看到「送不出去」。
  if (!Feedback.available()) {
    sendButton.disabled = true;
    state.className = 'fb-state bad';
    state.textContent = '意見箱要連上線才送得出去（realtime-config.js 沒有填 Supabase）。';
  }

  window.FeedbackUI = {
    open: open,
    close: close,
  };
})();
