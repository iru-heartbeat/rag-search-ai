import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * 全ページ共通の入口（Next.js 16 の proxy。旧 middleware）。
 *
 * - セッション Cookie を検証・更新する
 * - 未ログインで保護ページ（/ など）を開いたら /login へ飛ばす
 * - ログイン済みで /login を開いたら / へ飛ばす
 *
 * これは「画面遷移のための楽観的チェック」。データの最終的な守りは
 * API route 側の getUser + ドメイン再検証と、DB の RLS が担う。
 */
export async function proxy(request: NextRequest) {
  const { response, isLoggedIn } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  // ログイン前でも開ける必要があるページ（ログイン画面と、メールリンクの戻り先など）
  const isPublic = pathname === "/login" || pathname.startsWith("/auth/");

  if (!isLoggedIn && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    // ログイン後に元のページへ戻れるよう、開こうとしたパスを持たせる
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname + search);
    return redirectKeepingCookies(loginUrl, response);
  }

  if (isLoggedIn && pathname === "/login") {
    return redirectKeepingCookies(new URL("/", request.url), response);
  }

  return response;
}

/** updateSession が書いた Cookie（更新・削除）をリダイレクトにも引き継ぐ */
function redirectKeepingCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  // 次のパスでは proxy を動かさない:
  // - api/*: リダイレクトせず route 側で 401 を返す取り決め（認証確認も route 側で行う）
  // - Next.js の静的ファイル・画像最適化・favicon・画像ファイル
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
