// 評価結果の集計とレポート（Markdown）作成。

import type { Source } from "../../src/lib/types";
import type { Judgement } from "./judge";
import type { TestCase } from "./testset";

/** 1問ぶんの評価結果 */
export type CaseResult = {
  case: TestCase;
  /** answerQuestion の結果。API エラーなどで回答を得られなかったら "error" */
  status: "answered" | "not_found" | "error";
  answer: string;
  sources: Source[];
  /** この問題に正解したか */
  correct: boolean;
  /** 範囲内で回答した問題について、期待した根拠（ファイル+ページ）が出典に含まれるか */
  sourceMatched: boolean | null;
  judgement: Judgement | null;
  error: string | null;
  elapsedMs: number;
};

/** 目標値（要件定義書の非機能要件） */
export const TARGETS = {
  accuracy: 0.8,
  outOfScopeNotFoundRate: 1.0,
  sourceAttachRate: 1.0,
} as const;

type Ratio = { num: number; den: number };

export type Summary = {
  total: number;
  /** 正答率: 範囲内の質問のうち、要点をすべて押さえて回答できた割合 */
  accuracy: Ratio;
  /** 出典付与率: 「回答した」ケースのうち出典が1件以上付いている割合 */
  sourceAttach: Ratio;
  /** 該当なし率（範囲外）: 範囲外の質問のうち「該当なし」と返せた割合 */
  outOfScopeNotFound: Ratio;
  /** 参考: 範囲内の質問なのに「該当なし」になった割合（閾値が厳しすぎないかの目安） */
  inScopeNotFound: Ratio;
  /** 参考: 範囲内で回答したケースのうち、期待した根拠ページが出典に含まれる割合 */
  sourceMatch: Ratio;
  errors: number;
};

export function summarize(results: CaseResult[]): Summary {
  const inScope = results.filter((r) => !r.case.out_of_scope);
  const outOfScope = results.filter((r) => r.case.out_of_scope);
  const answered = results.filter((r) => r.status === "answered");
  const inScopeAnsweredWithEvidence = inScope.filter(
    (r) => r.status === "answered" && r.case.evidence.length > 0,
  );

  const count = <T>(items: T[], pred: (x: T) => boolean): number => items.filter(pred).length;

  return {
    total: results.length,
    accuracy: { num: count(inScope, (r) => r.correct), den: inScope.length },
    sourceAttach: { num: count(answered, (r) => r.sources.length > 0), den: answered.length },
    outOfScopeNotFound: { num: count(outOfScope, (r) => r.status === "not_found"), den: outOfScope.length },
    inScopeNotFound: { num: count(inScope, (r) => r.status === "not_found"), den: inScope.length },
    sourceMatch: { num: count(inScopeAnsweredWithEvidence, (r) => r.sourceMatched === true), den: inScopeAnsweredWithEvidence.length },
    errors: count(results, (r) => r.status === "error"),
  };
}

function rate(r: Ratio): number | null {
  return r.den === 0 ? null : r.num / r.den;
}

export function formatRatio(r: Ratio): string {
  const v = rate(r);
  return v === null ? "—（対象 0 件）" : `${(v * 100).toFixed(1)}%（${r.num}/${r.den}）`;
}

/** 目標を満たしているか。対象が 0 件の指標は判定しない（null） */
export function meets(r: Ratio, target: number): boolean | null {
  const v = rate(r);
  return v === null ? null : v >= target;
}

function mark(ok: boolean | null): string {
  return ok === null ? "—" : ok ? "✅ 達成" : "❌ 未達";
}

/** 目標のある3指標がすべて達成（または対象 0 件）か */
export function allTargetsMet(s: Summary): boolean {
  return [
    meets(s.accuracy, TARGETS.accuracy),
    meets(s.outOfScopeNotFound, TARGETS.outOfScopeNotFoundRate),
    meets(s.sourceAttach, TARGETS.sourceAttachRate),
  ].every((ok) => ok !== false);
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function formatSources(sources: Source[]): string {
  return sources.length === 0 ? "なし" : sources.map((s) => `${s.file_name} p.${s.page}`).join(", ");
}

function verdictLabel(r: CaseResult): string {
  if (r.status === "error") return "⚠ エラー";
  return r.correct ? "○" : "×";
}

/** なぜ不正解なのかを一言で */
function failureReason(r: CaseResult): string {
  if (r.status === "error") return `エラー: ${r.error}`;
  if (r.case.out_of_scope) return "範囲外の質問なのに回答した（「該当なし」にすべき）";
  if (r.status === "not_found") return "範囲内の質問なのに「該当なし」になった";
  const missing = r.judgement?.points.filter((p) => !p.covered).map((p) => p.point) ?? [];
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`押さえていない要点: ${missing.join(" / ")}`);
  if (r.judgement?.contradicts) parts.push("要点と矛盾する内容あり");
  return parts.join("。") || "不正解";
}

export type RunInfo = {
  startedAt: Date;
  testSetPath: string;
  topK: number;
  similarityThreshold: number;
  answerModel: string;
  judgeModel: string;
};

export function buildMarkdown(info: RunInfo, summary: Summary, results: CaseResult[]): string {
  const lines: string[] = [];
  lines.push(`# 精度評価レポート（${info.startedAt.toLocaleString("ja-JP")}）`, "");

  lines.push("## 実行条件", "");
  lines.push(`- テストセット: \`${info.testSetPath}\`（${summary.total} 問）`);
  lines.push(`- TOP_K: ${info.topK} / 類似度の閾値: ${info.similarityThreshold}`);
  lines.push(`- 回答モデル: ${info.answerModel} / 採点モデル: ${info.judgeModel}`, "");

  lines.push("## 集計", "");
  lines.push("| 指標 | 結果 | 目標 | 判定 |", "|---|---|---|---|");
  lines.push(`| 正答率（範囲内の質問） | ${formatRatio(summary.accuracy)} | 80% 以上 | ${mark(meets(summary.accuracy, TARGETS.accuracy))} |`);
  lines.push(`| 出典付与率（回答したもの） | ${formatRatio(summary.sourceAttach)} | 100% | ${mark(meets(summary.sourceAttach, TARGETS.sourceAttachRate))} |`);
  lines.push(`| 該当なし率（範囲外の質問） | ${formatRatio(summary.outOfScopeNotFound)} | 100% | ${mark(meets(summary.outOfScopeNotFound, TARGETS.outOfScopeNotFoundRate))} |`);
  lines.push(`| 参考: 範囲内なのに該当なし | ${formatRatio(summary.inScopeNotFound)} | 低いほど良い | — |`);
  lines.push(`| 参考: 出典が期待ページと一致 | ${formatRatio(summary.sourceMatch)} | 高いほど良い | — |`);
  lines.push(`| エラー | ${summary.errors} 件 | 0 件 | ${summary.errors === 0 ? "✅" : "⚠"} |`, "");

  const failed = results.filter((r) => !r.correct);
  lines.push(`## 不正解・エラーの詳細（${failed.length} 件）`, "");
  if (failed.length === 0) lines.push("なし", "");
  for (const r of failed) {
    lines.push(`### ${r.case.id}: ${r.case.question}`, "");
    lines.push(`- 区分: ${r.case.out_of_scope ? "範囲外" : "範囲内"}`);
    lines.push(`- 理由: ${failureReason(r)}`);
    if (r.judgement) lines.push(`- 採点コメント: ${r.judgement.reason}`);
    if (r.case.evidence.length > 0) {
      lines.push(`- 期待した根拠: ${r.case.evidence.map((e) => `${e.file_name} p.${e.page}`).join(", ")}`);
    }
    lines.push(`- 実際の出典: ${formatSources(r.sources)}`);
    lines.push("- 回答:", "", "```text", r.answer || "（なし）", "```", "");
  }

  lines.push("## 全問の結果", "");
  lines.push("| ID | 区分 | 判定 | 状態 | 出典 | 根拠一致 | 時間 |", "|---|---|---|---|---|---|---|");
  for (const r of results) {
    const match = r.sourceMatched === null ? "—" : r.sourceMatched ? "○" : "×";
    lines.push(
      `| ${r.case.id} | ${r.case.out_of_scope ? "範囲外" : "範囲内"} | ${verdictLabel(r)} | ${r.status} | ${escapeCell(formatSources(r.sources))} | ${match} | ${(r.elapsedMs / 1000).toFixed(1)}s |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
