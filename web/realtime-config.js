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
