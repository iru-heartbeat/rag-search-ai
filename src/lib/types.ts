// 並行開発する各ブランチ（DB / 取り込み / チャットAPI）の間の「取り決め」。
// ここを変えるときは全ブランチに影響するので、main で変更してから各ブランチに取り込む。

/** 埋め込みモデルとその次元数。DB の vector(1536) と必ず一致させる */
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

/** 取り込みスクリプトが chunks テーブルに書き込む1行分 */
export type ChunkInsert = {
  document_id: string;
  page: number;
  content: string;
  embedding: number[];
};

/** RPC match_chunks(query_embedding, k) が返す1行分 */
export type MatchedChunk = {
  id: string;
  document_id: string;
  file_name: string;
  page: number;
  content: string;
  /** コサイン類似度（1 に近いほど似ている） */
  similarity: number;
};

/** 回答に付ける出典。取得済みチャンクからのみ組み立てる */
export type Source = {
  chunk_id: string;
  file_name: string;
  page: number;
};

/** POST /api/chat のレスポンス */
export type ChatResponse =
  | { status: "answered"; answer: string; sources: Source[] }
  | { status: "not_found"; answer: string; sources: [] };
