import type { Source } from "@/lib/types";

/**
 * 画面に表示する1往復（質問 + その結果）。
 * 結果は「待機中 / 回答あり / 該当なし / エラー」のどれか1つ。
 */
export type Turn = {
  id: number;
  question: string;
  result:
    | { kind: "pending" }
    | { kind: "answered"; answer: string; sources: Source[] }
    | { kind: "not_found"; answer: string }
    | { kind: "error"; status: number | null; message: string };
};
