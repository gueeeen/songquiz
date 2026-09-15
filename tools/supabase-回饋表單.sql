-- 完整回饋表單用的表。
--
-- 怎麼跑：Supabase 後台左邊選 SQL Editor → New query → 把這整段貼進去 → Run。
-- 只需要跑一次。跑完 web/feedback.html 那份表單才送得出去。
--
-- 和 feedback 那張表的關係：那張是遊戲裡的意見箱（幾顆星 + 一句話），
-- 這張是點「填寫完整回饋表單」之後的那一份。兩張分開是因為填的人不同——
-- 意見箱是所有人都會看到的，完整表單是願意坐下來填五分鐘的人才會進去，
-- 混在一起的話那五個必填星等有九成是空的，平均值就沒有意義了。
--
-- 和排行榜最大的差別一樣：**這張表只給寫，不給讀。**
-- 你要看回饋就到 Supabase 後台的 Table Editor（後台用 service key，不受 RLS 限制）。

create table if not exists public.feedback_form (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  -- 五個大項的星等。這五個是必填的。
  --
  -- 為什麼拉成獨立欄位而不是全部塞進 answers：這五個是你最常看的數字，
  -- 獨立成欄才排得了序、算得了平均。後台按一下欄位標題就能排，不必寫 SQL。
  overall       int not null check (overall between 1 and 5),   -- 整體
  songs         int not null check (songs between 1 and 5),     -- 歌單
  modes         int not null check (modes between 1 and 5),     -- 遊戲模式
  looks         int not null check (looks between 1 and 5),     -- 美術
  features      int not null check (features between 1 and 5),  -- 其他功能

  -- 其餘全部放這裡：每一個大項的文字、複選、以及依「玩過什麼」展開的細項星等。
  --
  -- 用 jsonb 而不是三十個欄位，是因為這份表單本來就會一直改
  -- （加一個模式、加一個功能、改一次選項）。每改一次就 alter table 一次，
  -- 舊資料還會多出一堆永遠是 null 的欄位。
  -- 代價是查詢要寫 answers->>'xxx'，但這張表一天寫不到幾筆，查詢不是瓶頸。
  answers       jsonb not null default '{}'::jsonb,

  -- 出問題的時候要知道是什麼環境。不放 IP、不放任何可以認出個人的東西。
  device        text check (char_length(device) <= 200)
);

alter table public.feedback_form enable row level security;

-- 任何人都能填。
--
-- 刻意「只給 insert」：沒有 select 政策，拿 publishable key 的人
-- 寫得進去、讀不出來，別人填的內容不會被整批撈走。
-- 也沒有 update / delete，送出去的東西改不掉也刪不掉。
drop policy if exists "anyone can submit the form" on public.feedback_form;
create policy "anyone can submit the form"
  on public.feedback_form for insert
  to anon, authenticated
  with check (true);

-- 看回饋的時候一定是「最新的在前面」。
create index if not exists feedback_form_recent_idx
  on public.feedback_form (created_at desc);

-- 常用的幾個查詢，貼到 SQL Editor 就能用：
--
--   -- 五個大項的平均與份數
--   select count(*) as 份數,
--          round(avg(overall), 2) as 整體,
--          round(avg(songs), 2)   as 歌單,
--          round(avg(modes), 2)   as 模式,
--          round(avg(looks), 2)   as 美術,
--          round(avg(features), 2) as 功能
--   from public.feedback_form;
--
--   -- 每個模式各自的平均（只算有玩過、有評分的人）
--   select key as 模式, round(avg(value::int), 2) as 平均, count(*) as 人數
--   from public.feedback_form, jsonb_each_text(answers->'modeStars')
--   group by key order by 平均 desc;
--
--   -- 美術哪一項最多人不滿意
--   select item as 項目, count(*) as 人數
--   from public.feedback_form, jsonb_array_elements_text(answers->'looksBad') as item
--   group by item order by 人數 desc;
--
--   -- 所有文字回饋，最新的在前面
--   select created_at, overall, answers->>'overallWhy' as 整體, answers->>'other' as 其他
--   from public.feedback_form order by created_at desc;
