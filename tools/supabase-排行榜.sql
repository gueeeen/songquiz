-- 線上排行榜用的表。
--
-- 怎麼跑：Supabase 後台左邊選 SQL Editor → New query → 把這整段貼進去 → Run。
-- 只需要跑一次。跑完就可以在遊戲的結算頁留暱稱上榜。
--
-- 為什麼要你自己跑：建表要專案的管理權限，而這個遊戲只拿得到 publishable key
-- （設計上可以公開的那一把）。那把 key 能做的事，完全由下面的 RLS 政策決定。

create table if not exists public.scores (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  -- 暱稱：現場喊得出來就好，限制長度免得有人塞一整篇進來
  nickname      text not null check (char_length(nickname) between 1 and 12),

  -- 這一局的設定。排行榜一定要按設定分開比——
  -- 5 題的積分和 20 題的闖關不是同一件事，混在一起排名毫無意義。
  mode          text not null check (mode in ('stage', 'speed', 'combo')),
  question_count int  not null check (question_count between 1 and 50),
  languages     text not null check (char_length(languages) between 1 and 80),

  -- 成績
  score         int not null check (score between 0 and 1000000),
  stage         int     check (stage between 0 and 20),
  correct       int not null check (correct >= 0),
  total         int not null check (total > 0)
);

alter table public.scores enable row level security;

-- 任何人都能看榜。
drop policy if exists "anyone can read scores" on public.scores;
create policy "anyone can read scores"
  on public.scores for select
  to anon, authenticated
  using (true);

-- 任何人都能留下自己的成績。
--
-- 刻意「只給 insert，不給 update / delete」：沒有這兩條政策，
-- 拿 publishable key 的人就改不動也刪不掉別人的紀錄——榜是只進不出的。
-- 上面那些 check 限制了欄位的範圍，擋掉最粗糙的亂塞。
--
-- 老實說：分數是玩家的瀏覽器算出來再送上來的，改 JavaScript 就能送一個假分數。
-- 要真正防作弊，判分必須搬回伺服器（見「架構.md」第三節）。
-- 這個榜是給朋友之間玩的，不是競賽計分系統。
drop policy if exists "anyone can add a score" on public.scores;
create policy "anyone can add a score"
  on public.scores for insert
  to anon, authenticated
  with check (true);

-- 查榜一定是「同一組設定、分數由高到低」，直接照那個形狀建索引。
create index if not exists scores_board_idx
  on public.scores (mode, question_count, languages, score desc);
