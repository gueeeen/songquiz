// 前端只有三件工作：放音樂、跑一條計時條、把玩家點到的選項編號送回去。
// 正解、分數、關卡判定全在伺服器——瀏覽器手上沒有能作弊的資料。

const names = { mandarin: '華語', taiwanese: '台語', western: '西洋', korean: '韓語', japanese: '日語' };

const api = {
  bank: () => get('/api/bank'),
  sample: () => get('/api/bank/sample'),
  start: (mode) => post('/api/games', { mode }),
  question: (id) => post(`/api/games/${id}/question`, {}),
  answer: (id, choiceId) => post(`/api/games/${id}/answer`, { choiceId }),
  result: (id) => get(`/api/games/${id}/result`),
};

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error ?? detail.detail ?? `${res.status} ${url}`);
  }
  return res.json();
}

const el = (id) => document.getElementById(id);
const screens = { home: el('screen-home'), play: el('screen-play'), result: el('screen-result') };
const player = el('player');

const state = {
  gameId: null,
  mode: null,
  /** 這一題的計時器 handle，離開畫面時要收乾淨。 */
  ticker: null,
  /** 這一題的截止時間（performance.now 座標）。 */
  deadline: 0,
  /** 防連點：一題只能送一次答案。 */
  answering: false,
};

function show(name) {
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
}

// ---- 音量 ----
const volume = el('volume');

function applyVolume() {
  player.volume = volume.value / 100;
  el('volume-out').textContent = `${volume.value}%`;
  localStorage.setItem('songquiz.volume', volume.value);
}

volume.value = localStorage.getItem('songquiz.volume') ?? 80;
volume.addEventListener('input', applyVolume);
applyVolume();

el('btn-test').addEventListener('click', async () => {
  try {
    const { previewUrl } = await api.sample();
    player.src = previewUrl;
    await player.play();
    setTimeout(() => player.pause(), 3000); // 試聽三秒，夠判斷音量
  } catch {
    el('bank-line').textContent = '試聽失敗——檢查一下網路連線。';
  }
});

// ---- 開場：題庫狀態 ----
(async function loadBank() {
  try {
    const bank = await api.bank();
    if (bank.empty) {
      el('bank-line').textContent = '題庫還是空的。先跑：dotnet run --project tools/SongQuiz.BankBuilder';
      return;
    }
    const census = Object.entries(bank.census)
      .map(([lang, n]) => `${names[lang] ?? lang} ${n}`)
      .join('、');
    el('bank-line').textContent = `題庫：${bank.tracks} 首（${census}）＋ ${bank.decoys} 個誘餌`;
  } catch {
    el('bank-line').textContent = '連不上伺服器。';
  }
})();

// ---- 開一場 ----
for (const button of document.querySelectorAll('.mode')) {
  button.addEventListener('click', () => startGame(button.dataset.mode));
}

async function startGame(mode) {
  try {
    const game = await api.start(mode);
    state.gameId = game.id;
    state.mode = mode;
    el('hud-score').textContent = '0';
    show('play');
    await nextQuestion();
  } catch (err) {
    show('home');
    el('bank-line').textContent = `開場失敗：${err.message}`;
  }
}

// ---- 出題 ----
async function nextQuestion() {
  stopTimer();
  el('verdict').hidden = true;
  el('play-hint').textContent = '正在播放…選出你聽到的那一首';

  const question = await api.question(state.gameId);
  if (question.done) return showResult();

  el('hud-stage').textContent = question.stageLabel ?? '競速模式';
  el('hud-progress').textContent = `第 ${question.number} / ${question.total} 題`;
  el('hud-target').textContent =
    question.scoreToClear > 0 ? `過關需 ${question.scoreToClear.toLocaleString()}` : '';

  renderChoices(question.choices);
  playPreview(question.previewUrl);
  startTimer(question.seconds);
  state.answering = false;
}

function renderChoices(choices) {
  const box = el('choices');
  box.replaceChildren();
  for (const choice of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = choice.label;
    button.dataset.id = choice.id;
    button.addEventListener('click', () => submit(choice.id));
    box.append(button);
  }
}

function playPreview(url) {
  player.src = url;
  player.currentTime = 0;
  // 自動播放需要使用者手勢，而「選模式／下一題」那一下就是手勢，所以這裡不會被擋。
  player.play().catch(() => {
    el('play-hint').textContent = '瀏覽器擋住了自動播放——點畫面任一處再試。';
  });
}

// ---- 計時條 ----
function startTimer(seconds) {
  const bar = el('timer-bar');
  const text = el('timer-text');
  const timer = document.querySelector('.timer');
  timer.classList.remove('urgent');

  state.deadline = performance.now() + seconds * 1000;

  state.ticker = setInterval(() => {
    const left = Math.max(0, state.deadline - performance.now()) / 1000;
    bar.style.transform = `scaleX(${left / seconds})`;
    text.textContent = left.toFixed(1);
    if (left <= 3) timer.classList.add('urgent');
    if (left === 0) submit(null); // 時間到：當成沒作答送出，分數由伺服器算（零分）
  }, 50);
}

function stopTimer() {
  if (state.ticker) clearInterval(state.ticker);
  state.ticker = null;
}

// ---- 作答 ----
async function submit(choiceId) {
  if (state.answering) return;
  state.answering = true;
  stopTimer();
  player.pause();

  for (const button of document.querySelectorAll('.choice')) button.disabled = true;

  const outcome = await api.answer(state.gameId, choiceId);

  const picked = document.querySelector(`.choice[data-id="${choiceId}"]`);
  const right = document.querySelector(`.choice[data-id="${outcome.correctChoiceId}"]`);
  right?.classList.add('correct');
  if (!outcome.correct) picked?.classList.add('wrong');

  showVerdict(outcome);
}

function showVerdict(outcome) {
  const box = el('verdict');
  const title = el('verdict-title');
  const answer = el('verdict-answer');
  const next = el('btn-next');

  box.hidden = false;
  box.classList.toggle('ok', outcome.correct);
  box.classList.toggle('no', !outcome.correct);

  title.textContent = outcome.correct ? `答對！＋${outcome.gained}` : '答錯';
  answer.textContent = outcome.correct ? outcome.correctLabel : `正解：${outcome.correctLabel}`;
  el('hud-score').textContent = outcome.roundScore.toLocaleString();

  switch (outcome.status) {
    case 'stageCleared':
      title.textContent = `第 ${outcome.stage} 關過關！`;
      answer.textContent =
        `這一關 ${outcome.roundScore.toLocaleString()} 分（門檻 ${outcome.scoreToClear.toLocaleString()}）`;
      next.textContent = `前往第 ${outcome.stage + 1} 關`;
      next.onclick = nextQuestion;
      return;

    case 'stageFailed':
    case 'finished':
      next.textContent = '看結算';
      next.onclick = showResult;
      return;

    default:
      next.textContent = '下一題';
      next.onclick = nextQuestion;
  }
}

// ---- 結算 ----
async function showResult() {
  stopTimer();
  player.pause();

  const result = await api.result(state.gameId);
  show('result');

  const stageMode = result.mode === 'stage';
  el('result-title').textContent = stageMode
    ? (result.status === 'finished' ? '六關全破！' : `闖關失敗：第 ${result.stage} 關`)
    : '競速結算';

  el('result-score').textContent = result.totalScore.toLocaleString();
  el('result-of').textContent = stageMode ? '分（累積）' : `/ ${result.perfectScore.toLocaleString()}`;

  const correct = result.records.filter((r) => r.correct).length;
  el('result-note').textContent = stageMode
    ? `打到第 ${result.stage} / ${result.stageCount} 關，共答對 ${correct} 題`
    : `答對 ${correct} / ${result.records.length} 題`;

  const list = el('review');
  list.replaceChildren();
  for (const record of result.records) {
    const item = document.createElement('li');
    item.className = record.correct ? 'ok' : 'no';

    const song = document.createElement('span');
    song.className = 'song';
    const title = document.createElement('b');
    title.textContent = record.title;
    const meta = document.createElement('i');
    meta.textContent = `${record.artist}・${names[record.language] ?? record.language}`;
    song.append(title, meta);

    const points = document.createElement('span');
    points.className = 'pts';
    points.textContent = record.correct ? `${record.gained} 分・${record.seconds} 秒` : '—';

    item.append(song, points);
    list.append(item);
  }
}

el('btn-again').addEventListener('click', () => startGame(state.mode));
el('btn-home').addEventListener('click', () => {
  stopTimer();
  player.pause();
  show('home');
});
