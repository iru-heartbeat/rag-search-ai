// テストセット（data/eval/*.json）の型と読み込み。
// 書き方は data/eval/README.md を参照。

import { readFile } from "node:fs/promises";

/** 根拠の場所（ファイル名 + ページ番号） */
export type Evidence = { file_name: string; page: number };

/** テストセットの1問 */
export type TestCase = {
  /** 結果を見分けるための ID（例: "q001"） */
  id: string;
  question: string;
  /**
   * 範囲外の質問か。true なら「該当なし」が返れば正解。
   * 文書に書かれていない事柄・文書から推論しないと答えられない判断がこれにあたる。
   */
  out_of_scope: boolean;
  /** 期待する答えの要点。回答がすべて押さえていれば正解（範囲外なら空配列） */
  expected_points: string[];
  /** 根拠のファイルとページ（範囲外なら空配列）。出典が合っているかの参考指標に使う */
  evidence: Evidence[];
};

function fail(index: number, message: string): never {
  throw new Error(`テストセットの ${index + 1} 問目が不正です: ${message}`);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** 1問ぶんの形をチェックする。JSON は手書きするので、間違いを早めに分かりやすく知らせる */
function validate(raw: unknown, index: number): TestCase {
  if (typeof raw !== "object" || raw === null) fail(index, "オブジェクトではありません");
  const r = raw as Record<string, unknown>;

  if (typeof r.id !== "string" || !r.id) fail(index, "id がありません");
  if (typeof r.question !== "string" || !r.question.trim()) fail(index, `${r.id}: question がありません`);
  if (typeof r.out_of_scope !== "boolean") fail(index, `${r.id}: out_of_scope は true / false で書いてください`);
  if (!isStringArray(r.expected_points)) fail(index, `${r.id}: expected_points は文字列の配列にしてください`);
  if (!Array.isArray(r.evidence)) fail(index, `${r.id}: evidence は配列にしてください`);

  const evidence = r.evidence.map((e, j) => {
    const ev = e as Record<string, unknown>;
    if (typeof ev?.file_name !== "string" || !Number.isInteger(ev?.page) || (ev.page as number) < 1) {
      fail(index, `${r.id}: evidence[${j}] は { "file_name": 文字列, "page": 1以上の整数 } にしてください`);
    }
    return { file_name: ev.file_name as string, page: ev.page as number };
  });

  if (!r.out_of_scope && r.expected_points.length === 0) {
    fail(index, `${r.id}: 範囲内の質問には expected_points を1つ以上書いてください`);
  }
  if (r.out_of_scope && (r.expected_points.length > 0 || evidence.length > 0)) {
    fail(index, `${r.id}: 範囲外の質問では expected_points / evidence を空にしてください`);
  }

  return {
    id: r.id,
    question: r.question,
    out_of_scope: r.out_of_scope,
    expected_points: r.expected_points,
    evidence,
  };
}

export async function loadTestSet(filePath: string): Promise<TestCase[]> {
  const raw: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!Array.isArray(raw)) throw new Error("テストセットは配列（[ ... ]）で書いてください");
  const cases = raw.map(validate);

  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`id が重複しています: ${c.id}`);
    ids.add(c.id);
  }
  return cases;
}
