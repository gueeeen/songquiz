// 把手打的歌手名單解析成 artistId。
//
// Artists.cs 存的是 artistId 不是名字，理由寫在那一支的檔頭（簡言之：用名字搜會
// 靜靜地拿錯人，搜「LiSA」會給你小野麗莎）。這一支就是「名字 → id」那一步。
//
//   node resolve.mjs mandarin taiwanese japanese korean western
//
// 讀 names.json（每個語種一個名字陣列），寫 ids.json（taken／skipped 兩半）。
// **ids.json 要進版控**：那是 296 次請求換來的，重跑一次要二十分鐘，而且每多跑
// 一次就多一次被 Apple 擋的機會。要加歌手就把名字加進 names.json 再跑一次——
// 已經解出來的會跳過（印「-」），只有新的會發請求。
//
// 解完之後 Artists.cs 是人工從 ids.json 貼過去的，刻意不自動生成：跳過的那些
// （同名、Apple 用別的寫法）要一個一個看過才知道該不該手動補 id。
//
// 每一次請求間隔 2.1 秒，被擋（403／429）就退讓 4／8／12／16 秒。
// 印出來的符號：· 精確吻合　~ Apple 用別的寫法但曲風對得上　✗ 跳過　! 一直被擋

import fs from 'node:fs';

const names = JSON.parse(fs.readFileSync('names.json', 'utf8'));
const want = process.argv.slice(2);
const OUT = 'ids.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]/g, '');

// Genres.cs 的關鍵字表（同一份規則，順序有意義：細的在前）
const GENRE = [
  ['台灣流行', 'taiwanese'], ['台語', 'taiwanese'], ['Taiwanese', 'taiwanese'],
  ['粵語', 'cantonese'], ['Cantopop', 'cantonese'],
  ['華語', 'mandarin'], ['國語', 'mandarin'], ['中文', 'mandarin'], ['Mandopop', 'mandarin'], ['Chinese', 'mandarin'],
  ['K-Pop', 'korean'], ['韓國', 'korean'], ['韓語', 'korean'], ['Korean', 'korean'],
  ['J-Pop', 'japanese'], ['日本', 'japanese'], ['日語', 'japanese'], ['Japanese', 'japanese'],
  ['Anime', 'japanese'], ['動畫', 'japanese'], ['アニメ', 'japanese'],
];
const langOf = (genre) => {
  if (!genre) return null;
  for (const [key, lang] of GENRE) if (genre.toLowerCase().includes(key.toLowerCase())) return lang;
  return null;
};

const store = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

async function candidates(name) {
  const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(name)
    + '&country=TW&media=music&entity=musicArtist&limit=5';

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.status === 200) return (await res.json()).results || [];
    if (res.status !== 403 && res.status !== 429) return null;

    const wait = 4000 * (attempt + 1);
    process.stdout.write('(' + res.status + '→' + wait / 1000 + 's)');
    await sleep(wait);
  }
  return null;
}

for (const language of want) {
  store[language] = store[language] || { taken: [], skipped: [] };
  const done = new Set(store[language].taken.map((t) => t.name)
    .concat(store[language].skipped.map((s) => s.name)));

  process.stdout.write('\n' + language + '：');

  for (const name of names[language]) {
    if (done.has(name)) { process.stdout.write('-'); continue; }

    const rows = await candidates(name);
    if (rows === null) { store[language].skipped.push({ name, why: '一直被擋' }); process.stdout.write('!'); await sleep(2100); continue; }

    const exact = rows.filter((r) => norm(r.artistName) === norm(name));

    if (exact.length === 1) {
      store[language].taken.push({ name, id: exact[0].artistId, apple: exact[0].artistName, genre: exact[0].primaryGenreName });
      process.stdout.write('·');
    } else if (exact.length === 0 && rows.length && langOf(rows[0].primaryGenreName) === language) {
      // Apple 用別的寫法（宇多田ヒカル → Hikaru Utada）。曲風對得上才收。
      store[language].taken.push({ name, id: rows[0].artistId, apple: rows[0].artistName, genre: rows[0].primaryGenreName, renamed: true });
      process.stdout.write('~');
    } else {
      store[language].skipped.push({
        name,
        why: exact.length > 1 ? '多個精確吻合（' + exact.map((e) => e.artistName + '/' + e.primaryGenreName).join('、') + '）'
          : rows.length ? '沒有精確吻合，第一候選是「' + rows[0].artistName + '／' + rows[0].primaryGenreName + '」'
          : '完全沒有候選',
      });
      process.stdout.write('✗');
    }

    fs.writeFileSync(OUT, JSON.stringify(store, null, 1));
    await sleep(2100);
  }
}

console.log('');
for (const language of want) {
  console.log('  ' + language.padEnd(11) + '採用 ' + store[language].taken.length + '　跳過 ' + store[language].skipped.length);
}
