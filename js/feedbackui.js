// 意見箱的畫面層：結算頁那排星星，以及獨立的詳細表單。
//
// 送出本身在 feedback.js，這裡只管畫面。分開的理由和排行榜一樣：
// 「怎麼送」和「長什麼樣子」壞掉的原因不同，混在一起會兩邊都難查。

(function () {
  'use strict';

  var Feedback = window.Feedback;

  function el(id) {
    return document.getElementById(id);
  }

  var STARS = 5;

  /**
   * 畫一排星星。回傳一個讀寫目前分數的小物件。
   *
   * 用 button 而不是 input[type=radio]：五顆星要能「點第三顆就是三分」，
   * 而且已經選了三分再點第三顆要能取消（那是「我不想回答這一項」，
   * 和「給三分」不是同一件事——資料庫那邊也分得出來，沒填是 null）。
   */
  function makeStars(host, onChange) {
    var value = 0;
    var buttons = [];

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
          set(score === value ? 0 : score);
          if (onChange) onChange(value);
        });
        buttons.push(button);
        host.append(button);
      })(i);
    }

    function set(next) {
      value = next;
      buttons.forEach(function (button, index) {
        var on = index < value;
        button.classList.toggle('on', on);
        button.setAttribute('aria-checked', index + 1 === value ? 'true' : 'false');
      });
    }

    return {
      get: function () { return value; },
      set: set,
    };
  }

  // ------------------------------------------------------------ 結算頁那一排

  var quickStars = makeStars(el('rate-stars'), function (value) {
    el('btn-rate-send').disabled = value === 0;
  });

  var quickState = el('rate-state');

  /** 快速評分那一塊裡，送出後要收起來的那幾個東西。 */
  function quickForm() {
    return document.querySelectorAll('#rate-box .rate-ask, #rate-box .stars, #rate-box .rate-line, #rate-box .linkish');
  }

  function showQuickForm(show) {
    var parts = quickForm();
    for (var i = 0; i < parts.length; i++) parts[i].hidden = !show;
  }

  function quickSent() {
    // 送出之後把整塊換成一句話。留著表單會讓人以為沒送出去，然後再送一次。
    showQuickForm(false);
    quickState.className = 'rate-state ok';
    quickState.textContent = '收到了，謝謝。想再多講的話，右上角的設定裡有完整的表單。';
  }


  el('btn-rate-send').addEventListener('click', function () {
    var button = this;
    button.disabled = true;
    quickState.className = 'rate-state';
    quickState.textContent = '送出中…';

    Feedback.send({
      stars: quickStars.get(),
      note: el('rate-note').value,
    }).then(quickSent).catch(function (error) {
      button.disabled = false;
      quickState.className = 'rate-state bad';
      quickState.textContent = '送不出去：' + error.message;
    });
  });

  el('btn-rate-more').addEventListener('click', function () {
    // 把剛剛給的星等帶過去，不要讓人在詳細表單裡再選一次同一件事。
    open(quickStars.get());
  });

  // ------------------------------------------------------------ 詳細表單

  var scales = {};
  var scaleHosts = document.querySelectorAll('#feedback-app .stars[data-scale]');
  for (var s = 0; s < scaleHosts.length; s++) {
    (function (host) {
      scales[host.dataset.scale] = makeStars(host, null);
    })(scaleHosts[s]);
  }

  var wantButtons = document.querySelectorAll('#fb-wants .chip');
  for (var w = 0; w < wantButtons.length; w++) {
    wantButtons[w].addEventListener('click', function () {
      var on = this.getAttribute('aria-pressed') === 'true';
      this.setAttribute('aria-pressed', on ? 'false' : 'true');
    });
  }

  function wants() {
    var picked = [];
    var buttons = document.querySelectorAll('#fb-wants .chip[aria-pressed="true"]');
    for (var i = 0; i < buttons.length; i++) picked.push(buttons[i].dataset.want);
    return picked;
  }

  var fbState = el('fb-state');

  el('btn-fb-send').addEventListener('click', function () {
    var button = this;

    if (!scales.stars.get()) {
      fbState.className = 'fb-state bad';
      fbState.textContent = '「整體」那一項要給幾顆星，其他都可以跳過。';
      return;
    }

    button.disabled = true;
    fbState.className = 'fb-state';
    fbState.textContent = '送出中…';

    Feedback.send({
      stars: scales.stars.get(),
      fun: scales.fun.get(),
      songs: scales.songs.get(),
      looks: scales.looks.get(),
      sound: scales.sound.get(),
      multiplayer: scales.multiplayer.get(),
      wants: wants(),
      detail: el('fb-detail').value,
    }).then(function () {
      fbState.className = 'fb-state ok';
      fbState.textContent = '收到了，謝謝。';
      button.disabled = true;
      button.textContent = '已送出';
    }).catch(function (error) {
      button.disabled = false;
      fbState.className = 'fb-state bad';
      fbState.textContent = '送不出去：' + error.message;
    });
  });

  // ------------------------------------------------------------ 開關

  /** 開啟詳細表單之前停在哪一半，關掉之後要回到那裡。 */
  var cameFrom = null;

  function open(stars) {
    if (!window.Shell) return;

    cameFrom = window.Shell.current();
    window.Shell.hidePanes();
    el('feedback-app').hidden = false;

    if (stars) scales.stars.set(stars);

    window.scrollTo(0, 0);
  }

  function close() {
    el('feedback-app').hidden = true;
    if (window.Shell) window.Shell.show(cameFrom || 'solo');
    window.scrollTo(0, 0);
  }

  el('btn-fb-back').addEventListener('click', close);

  // 沒設定 Supabase 的時候（例如直接用 file:// 打開）就講清楚，
  // 而不是讓人填完一整份表單才看到「送不出去」。
  if (!Feedback.available()) {
    var warning = '意見箱要連上線才送得出去（realtime-config.js 沒有填 Supabase）。';
    el('btn-rate-send').disabled = true;
    el('btn-fb-send').disabled = true;
    quickState.className = 'rate-state bad';
    quickState.textContent = warning;
    fbState.className = 'fb-state bad';
    fbState.textContent = warning;
  }

  window.FeedbackUI = {
    open: open,
    close: close,
    /** 重開一場的時候要把結算頁那一排重置，否則上一場的評分會留著。 */
    resetQuick: function () {
      quickStars.set(0);
      el('rate-note').value = '';
      showQuickForm(true);
      el('btn-rate-send').disabled = true;

      // 沒設定 Supabase 的時候那句說明要留著，不然重開一場就沒人知道為什麼送不出去。
      if (!Feedback.available()) return;
      quickState.className = 'rate-state';
      quickState.textContent = '';
    },

  };
})();
