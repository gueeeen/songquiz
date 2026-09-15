-- 意見箱用的表。
--
-- 怎麼跑：Supabase 後台左邊選 SQL Editor → New query → 把這整段貼進去 → Run。
-- 只需要跑一次。跑完遊戲裡的意見箱才送得出去。
--
-- 和排行榜最大的差別：**這張表只給寫，不給讀。**
-- 排行榜是要公開比較的，意見是寫給你一個人看的——如果開了 select，
-- 任何人都能把所有人的意見整批撈走。你要看意見就到 Supabase 後台的
-- Table Editor（後台用的是 service key，不受 RLS 限制）。

create table if not exists public.feedback (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  -- 星等。這是「一句話評價」那一版唯一必填的東西。
  stars         int not null check (stars between 1 and 5),

  -- 一句話。可以不留。
  note          text check (char_length(note) <= 500),

  -- 底下都是詳細回饋表單才會有的，快速評分那一版留空。
  -- 各自 1～5，沒填就是 null——「沒回答」和「給 3 分」不是同一件事，
  -- 用 0 當「沒填」會讓平均值算起來全部偏低。
  fun           int check (fun between 1 and 5),        -- 玩法好不好玩
  songs         int check (songs between 1 and 5),      -- 選歌與題目
  looks         int check (looks between 1 and 5),      -- 畫面與美術
  sound         int check (sound between 1 and 5),      -- 音樂與音質
  multiplayer   int check (multiplayer between 1 and 5),-- 多人房好不好用

  -- 「最想看到什麼」的複選，存成逗號分隔的字串。
  -- 存成陣列欄位會比較漂亮，但那要多一個型別，而這張表一天寫不到幾次。
  wants         text check (char_length(wants) <= 200),

  -- 詳細表單的自由文字。
  detail        text check (char_length(detail) <= 2000),

  -- 出問題的時候要知道是什麼環境。不放 IP、不放任何可以認出個人的東西。
  device        text check (char_length(device) <= 200)
);

alter table public.feedback enable row level security;

-- 任何人都能留意見。
--
-- 刻意「只給 insert」：沒有 select 政策，拿 publishable key 的人
-- 寫得進去、讀不出來，別人的意見不會被整批撈走。
-- 也沒有 update / delete，留下的東西改不掉也刪不掉。
drop policy if exists "anyone can leave feedback" on public.feedback;
create policy "anyone can leave feedback"
  on public.feedback for insert
  to anon, authenticated
  with check (true);

-- 看意見的時候一定是「最新的在前面」。
create index if not exists feedback_recent_idx
  on public.feedback (created_at desc);
