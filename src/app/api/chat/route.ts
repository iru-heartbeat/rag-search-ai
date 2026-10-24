import { NextResponse } from "next/server";
import type { ChatResponse } from "@/lib/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/chat/auth";
import { answerQuestion, SearchError } from "@/lib/chat/answer";
import { MAX_QUESTION_LENGTH } from "@/lib/chat/config";
import { GenerationError } from "@/lib/chat/generate";

// OpenAI / Anthropic SDK を使うので Node.js ランタイムで動かす。
// 実行リージョン（Supabase と同じ東京 hnd1）は vercel.json の regions で指定している
export const runtime = "nodejs";

type ErrorBody = { error: string };

function error(status: number, message: string) {
  return NextResponse.json<ErrorBody>({ error: message }, { status });
}

/**
 * POST /api/chat  body: { question: string }
 *
 * 入力チェック → 認証確認 → answerQuestion（検索・回答生成・出典照合）
 */
export async function POST(req: Request) {
  // 1. 入力チェック
  let question: string;
  try {
    const body: unknown = await req.json();
    const q = (body as { question?: unknown } | null)?.question;
    if (typeof q !== "string") return error(400, "question（文字列）を指定してください");
    question = q.trim();
  } catch {
    return error(400, "リクエストボディが JSON ではありません");
  }
  if (!question) return error(400, "質問が空です");
  if (question.length > MAX_QUESTION_LENGTH) {
    return error(400, `質問は${MAX_QUESTION_LENGTH}文字以内にしてください`);
  }

  try {
    // 2. 認証確認（getUser は Supabase Auth サーバーに問い合わせてトークンを検証する）
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return error(401, "ログインしてください");
    if (!isAllowedEmail(user)) return error(403, "このアカウントでは利用できません");

    // 3. 検索 → 回答生成 → 出典照合（評価スクリプトと共通の処理）
    return NextResponse.json<ChatResponse>(await answerQuestion(supabase, question));
  } catch (e) {
    console.error("chat failed", e);
    if (e instanceof SearchError) return error(500, "文書の検索に失敗しました");
    if (e instanceof GenerationError) return error(502, "回答の生成に失敗しました");
    return error(500, "サーバーでエラーが発生しました");
  }
}
