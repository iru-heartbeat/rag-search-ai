import { NextResponse } from "next/server";
import { embedText } from "@/lib/embedding";
import type { ChatResponse, MatchedChunk } from "@/lib/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/chat/auth";
import {
  MAX_QUESTION_LENGTH,
  NOT_FOUND_ANSWER,
  SIMILARITY_THRESHOLD,
  TOP_K,
} from "@/lib/chat/config";
import { GenerationError, generateAnswer, labelChunks } from "@/lib/chat/generate";
import { resolveSources } from "@/lib/chat/sources";

// OpenAI / Anthropic SDK を使うので Node.js ランタイムで動かし、Supabase と同じ東京に置く
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

type ErrorBody = { error: string };

function error(status: number, message: string) {
  return NextResponse.json<ErrorBody>({ error: message }, { status });
}

function notFound() {
  return NextResponse.json<ChatResponse>({
    status: "not_found",
    answer: NOT_FOUND_ANSWER,
    sources: [],
  });
}

/**
 * POST /api/chat  body: { question: string }
 *
 * 認証確認 → 質問を埋め込み → match_chunks で top-k 検索 → 類似度の閾値判定
 * → Claude で回答生成 → 返ってきた引用IDを取得済みチャンクと照合して出典を付ける
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

    // 3. 質問を埋め込みベクトルに変換（取り込み時と同じモデル・次元）
    const queryEmbedding = await embedText(question);

    // 4. ベクトル検索。ログイン中ユーザーの権限で実行されるので RLS が効く
    const { data, error: rpcError } = await supabase.rpc("match_chunks", {
      query_embedding: queryEmbedding,
      k: TOP_K,
    });
    if (rpcError) {
      console.error("match_chunks failed", rpcError);
      return error(500, "文書の検索に失敗しました");
    }
    const chunks = (data ?? []) as MatchedChunk[];

    // 5. 閾値判定。似ているチャンクが1件も無ければ LLM を呼ばずに「該当なし」
    const relevant = chunks.filter((c) => c.similarity >= SIMILARITY_THRESHOLD);
    if (relevant.length === 0) return notFound();

    // 6. Claude に文脈付きで回答させる
    const labeled = labelChunks(relevant);
    const generated = await generateAnswer(question, labeled);

    // 7. 出典照合。取得済みチャンクに一致する引用だけを出典にする。
    //    出典が1件も付けられない回答は「全回答に出典」の要件を満たさないので「該当なし」扱い
    const sources = resolveSources(generated.cited_ids, labeled);
    if (!generated.found || sources.length === 0 || !generated.answer.trim()) {
      return notFound();
    }

    return NextResponse.json<ChatResponse>({
      status: "answered",
      answer: generated.answer.trim(),
      sources,
    });
  } catch (e) {
    console.error("chat failed", e);
    if (e instanceof GenerationError) return error(502, "回答の生成に失敗しました");
    return error(500, "サーバーでエラーが発生しました");
  }
}
