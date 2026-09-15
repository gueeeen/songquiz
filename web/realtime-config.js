// 這個檔會進版控，只放「設計上可以公開」的 anon／public key。
// 沒填不影響單人遊戲——只有多人房間會用到。
//
// provider 可以是：
//   'none'      還沒設定。多人房間會退回「同一台電腦多分頁」的測試通道，
//               並在畫面上寫明「多人連線還沒設定」。
//   'broadcast' 明確指定用瀏覽器內建的 BroadcastChannel（同一台電腦才通）。
//   'supabase'  真正跨裝置。url 是專案網址，anonKey 填 publishable key
//               （sb_publishable_… 開頭；舊的 anon JWT 也還能用）。
//
// 為什麼這把 key 可以進版控：Supabase 官方文件把 publishable／anon key 列為
// 「Safe to expose online: web page, mobile or desktop app, GitHub actions,
// CLIs, source code」——它拿得到的東西，完全由伺服器端的 RLS 與 Realtime
// 設定決定。真正不能外流的是 secret key（sb_secret_… / service_role），
// 那一把永遠不要出現在這個資料夾裡的任何檔案。
//
// 要換掉這一把：Supabase 後台 Project Settings → API Keys 可以撤銷後重發，
// 改完這一行就生效，不必動任何程式。
window.REALTIME_CONFIG = {
  provider: 'supabase',
  url: 'https://lzvxmpcvzhlgagoosclk.supabase.co',
  anonKey: 'sb_publishable_kbj3NwBxDuWwMCEZXKoP3A_pYvxHJ_1',
};

// 完整回饋表單的網址（Google 表單、Typeform、什麼都可以）。
//
// 遊戲裡的意見箱只問「幾顆星」和「一句話」——那是剛打完的人願意花的力氣。
// 想問細項（滿意度分項、想看到什麼功能…）就做一份表單，把網址填在這裡，
// 意見箱下面才會出現通往它的連結。
//
// 留空字串的話那個連結就不會出現：一個點下去是空白頁的連結，比沒有連結更糟。
window.FEEDBACK_FORM_URL = '';
