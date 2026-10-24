import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * サーバー側（Route Handler など）で使う Supabase クライアント。
 *
 * ブラウザのログイン情報（Cookie）をそのまま引き継ぐので、
 * DB へのクエリは「ログイン中のユーザー」の権限で実行され、RLS が効く。
 * service_role キーはここでは絶対に使わない（RLS をすり抜けてしまうため）。
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません");
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // セッション更新時に Supabase が Cookie を書き換える。
        // Server Component から呼ばれた場合は書き込めず例外になるが、無視してよい。
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // 読み取り専用のコンテキストでは何もしない
        }
      },
    },
  });
}
