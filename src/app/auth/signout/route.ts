import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST /auth/signout — ログアウト。
 * UI からは <form action="/auth/signout" method="post"> で送信する。
 *
 * GET にしないのは、<img src="/auth/signout"> のようなリンクを踏まされただけで
 * 勝手にログアウトさせられるのを防ぐため（状態を変える操作は POST にする）。
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  // サーバー側のセッション（リフレッシュトークン）を無効化し、Cookie も削除する
  const { error } = await supabase.auth.signOut();
  if (error) console.error("signout failed", error);

  // 303: POST の後に GET で /login を開かせる（フォーム再送信を防ぐ）
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
