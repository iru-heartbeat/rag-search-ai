"use server";

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/app/auth/next-path";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

// メールアドレスの簡易チェック（厳密な判定は Supabase 側に任せる）
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * ログインフォームの送信先（Server Action）。
 * Supabase にマジックリンクのメール送信を依頼する。
 *
 * - 初回のメールアドレスなら、Supabase がユーザーを作成しようとする。
 *   その直前に before-user-created Hook が動き、社内ドメイン以外はここでエラーになる。
 * - PKCE 方式: 送信時にブラウザの Cookie に「検証用の合言葉（code verifier）」を保存し、
 *   メールのリンクで戻ってきたとき /auth/callback で照合する。
 *   → リンクを盗まれても、同じブラウザでなければログインできない。
 */
export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = safeNextPath(String(formData.get("next") ?? ""));

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { status: "error", message: "メールアドレスの形式が正しくありません" };
  }

  // メールのリンクの戻り先。Server Action は Origin ヘッダーが自サイトと一致する場合だけ
  // 実行される（Next.js の CSRF 対策）ので、Origin をそのまま使ってよい。
  // さらに Supabase 側でも「Redirect URLs」に登録した URL 以外は拒否される。
  const origin = (await headers()).get("origin");
  if (!origin) {
    return { status: "error", message: "リクエストが不正です。ページを再読み込みしてください" };
  }
  const callbackUrl = new URL("/auth/callback", origin);
  if (next !== "/") callbackUrl.searchParams.set("next", next);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl.toString() },
  });

  if (error) {
    console.error("signInWithOtp failed", error.status, error.code, error.message);
    if (error.status === 429) {
      return { status: "error", message: "送信回数の上限に達しました。しばらく待ってから再度お試しください" };
    }
    // Hook で拒否された場合もここに来る。理由の詳細は画面に出さない
    return {
      status: "error",
      message: "ログインメールを送信できませんでした。社内のメールアドレスか確認してください",
    };
  }

  return { status: "sent", email };
}
