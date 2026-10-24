import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/chat/auth";
import { safeNextPath } from "../next-path";

/**
 * GET /auth/callback — マジックリンクをクリックしたときの戻り先。
 *
 * メールのリンク → Supabase がリンクを検証 → このURLへ ?code=... 付きで戻ってくる。
 * ここで code をセッション（ログイン状態の Cookie）に交換する。
 *
 * 受け付ける形式は2つ:
 * - ?code=...                 : 既定の PKCE 方式（ログイン時と同じブラウザが必要）
 * - ?token_hash=...&type=...  : メールテンプレートを token_hash 方式に変えた場合
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));

  const toLogin = (error: string) => {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", error);
    return NextResponse.redirect(url);
  };

  const supabase = await createSupabaseServerClient();

  // 1. リンクの検証とセッション確立（成功すると Cookie にトークンが書き込まれる）
  let verifyError: unknown = null;
  if (code) {
    ({ error: verifyError } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type }));
  } else {
    return toLogin("link_invalid");
  }
  if (verifyError) {
    console.error("auth callback: verification failed", verifyError);
    return toLogin("link_invalid");
  }

  // 2. 社内ドメインの再確認。Hook 導入前に作られたユーザーや Hook の設定漏れに備える
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedEmail(user)) {
    await supabase.auth.signOut();
    return toLogin("domain_not_allowed");
  }

  // 3. 元々開こうとしていたページ（なければトップ）へ
  return NextResponse.redirect(new URL(next, request.url));
}
