// チャットAPIの調整用パラメータ。精度評価（npm run eval）の結果を見て調整する。

/** 検索で取ってくるチャンク数 */
export const TOP_K = 8;

/**
 * 類似度の下限。最も似ているチャンクでもこれ未満なら「該当なし」とし、LLM を呼ばない。
 * text-embedding-3-small のコサイン類似度は関連文書でも 0.3〜0.6 程度に収まることが多い。
 * 仮の値なので、評価用テストセットで「該当なし」の誤判定が最小になる値に調整すること。
 */
export const SIMILARITY_THRESHOLD = 0.3;

/** 質問文の最大文字数（巨大な入力でコストが跳ねないようにする） */
export const MAX_QUESTION_LENGTH = 1000;

/** 回答生成に使う Claude のモデル */
export const CLAUDE_MODEL = "claude-sonnet-5-5";

/** 根拠が見つからないときに返す定型文 */
export const NOT_FOUND_ANSWER =
  "該当なし：社内文書の中に、この質問に答えられる記載が見つかりませんでした。";
