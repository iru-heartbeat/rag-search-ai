import type { MatchedChunk, Source } from "../types";

/**
 * Claude が返したラベル（"C1" など）を、今回の検索で実際に取得したチャンクと照合して出典を作る。
 *
 * - 取得していないラベル（LLM のでっち上げ）は捨てる
 * - 同じラベルの重複は1つにまとめる
 * - ファイル名・ページ番号は必ず DB 由来の値を使う（LLM が書いた文字列は使わない）
 */
export function resolveSources(citedIds: string[], labeled: Map<string, MatchedChunk>): Source[] {
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const raw of citedIds) {
    const label = raw.trim().toUpperCase();
    const chunk = labeled.get(label);
    if (!chunk || seen.has(label)) continue;
    seen.add(label);
    sources.push({ chunk_id: chunk.id, file_name: chunk.file_name, page: chunk.page });
  }
  return sources;
}
