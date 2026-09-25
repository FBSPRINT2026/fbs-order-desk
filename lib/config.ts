// Public settings for this shop. Values set in Vercel's Environment Variables win;
// these defaults let the site run without them. None of these are secrets.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://tmkpbdcqguyzbddrsspr.supabase.co";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_Ga0630yEtiwUisjuZkKxdQ_sQoVO_Z6";
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://portal.fbsprint.com").replace(/\/$/, "");
export const EMAIL_FROM = process.env.EMAIL_FROM || "FBS Print <nicholas@fbsprint.com>";
export const SHOP_NOTIFY_EMAIL = process.env.SHOP_NOTIFY_EMAIL || "nicholas@fbsprint.com";
