import type { User } from "@supabase/supabase-js";

/**
 * 社内メールドメインの再検証（二重化の2段目）。
 * 1段目は Supabase Auth Hook（before-user-created）でユーザー作成時に弾いている。
 * ここでは Hook の設定漏れや、Hook 導入前に作られたユーザーに備えて API 側でも確認する。
 *
 * ALLOWED_EMAIL_DOMAIN が未設定なら「全員拒否」にする（設定ミスで全開放にならないように）。
 */
export function isAllowedEmail(user: User): boolean {
  const domain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
  const email = user.email?.trim().toLowerCase();
  if (!domain || !email) return false;
  // "foo@evil-example.co.jp" を "example.co.jp" と誤認しないよう、"@" 付きで末尾一致を見る
  return email.endsWith(`@${domain}`);
}
