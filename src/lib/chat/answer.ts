import type { SupabaseClient } from "@supabase/supabase-js";
import { embedText } from "@/lib/embedding";
import type { ChatResponse, MatchedChunk } from "@/lib/types";
import { NOT_FOUND_ANSWER, SIMILARITY_THRESHOLD, TOP_K } from "./config";
import { generateAnswer, labelChunks } from "./generate";
import { resolveSources } from "./sources";

export class SearchError extends Error {}

const NOT_FOUND: ChatResponse = { status: "not_found", answer: NOT_FOUND_ANSWER, sources: [] };

/**
 * 質問に回答する RAG の本体（チャットAPI と 評価スクリプトの共通処理）。
 *
 * 質問を埋め込み → match_chunks で top-k 検索 → 類似度の閾値判定
 * → Claude で回答生成 → 返ってきた引用IDを取得済みチャンクと照合して出典を付ける
 *
 * supabase は呼び出し側が用意する。チャットAPI はログイン中ユーザーのクライアント（RLS が効く）、
 * 評価スクリプトは service_role のクライアントを渡す。
 * 失敗時は SearchError / GenerationError を投げる。
 */
export async function answerQuestion(
  supabase: SupabaseClient,
  question: string,
): Promise<ChatResponse> {
  // 1. 質問を埋め込みベクトルに変換（取り込み時と同じモデル・次元）
  const queryEmbedding = await embedText(question);

  // 2. ベクトル検索
  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: queryEmbedding,
    k: TOP_K,
  });
  if (error) throw new SearchError(`match_chunks failed: ${error.message}`);
  const chunks = (data ?? []) as MatchedChunk[];

  // 3. 閾値判定。似ているチャンクが1件も無ければ LLM を呼ばずに「該当なし」
  const relevant = chunks.filter((c) => c.similarity >= SIMILARITY_THRESHOLD);
  if (relevant.length === 0) return NOT_FOUND;

  // 4. Claude に文脈付きで回答させる
  const labeled = labelChunks(relevant);
  const generated = await generateAnswer(question, labeled);

  // 5. 出典照合。取得済みチャンクに一致する引用だけを出典にする。
  //    出典が1件も付けられない回答は「全回答に出典」の要件を満たさないので「該当なし」扱い
  const sources = resolveSources(generated.cited_ids, labeled);
  if (!generated.found || sources.length === 0 || !generated.answer.trim()) {
    return NOT_FOUND;
  }

  return { status: "answered", answer: generated.answer.trim(), sources };
}
