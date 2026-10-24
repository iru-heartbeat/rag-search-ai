import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * proxy（旧 middleware）用の Supabase セッション更新。
 *
 * Server Component は Cookie を書き込めないため、期限切れのアクセストークンを
 * リフレッシュした結果をブラウザへ返せるのは proxy だけ。
 * ここで毎リクエスト「トークンを検証 → 必要なら更新して Cookie に書き戻す」を行う。
 *
 * 戻り値の response は、更新後の Cookie が載った「そのまま通す」レスポンス。
 * リダイレクトする場合も、この response の Cookie を引き継ぐこと（そうしないとセッションが消える）。
 */
export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません");
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // 1) 後続の Server Component が新しいトークンを読めるよう、リクエスト側にも反映
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        // 2) ブラウザに保存させるため、レスポンスを作り直して Set-Cookie を付ける
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // トークンを含むレスポンスが CDN にキャッシュされないためのヘッダー（Cache-Control など）
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // getClaims はアクセストークン（JWT）の署名を検証して中身を返す。
  // 期限切れならリフレッシュトークンで更新し、その結果が上の setAll に渡る。
  // 注意: createServerClient とこの呼び出しの間に別の処理を挟まないこと（セッションが不整合になる）。
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims?.sub);

  return { response, isLoggedIn };
}
