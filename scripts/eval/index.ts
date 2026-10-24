// 精度評価スクリプト（ローカル実行専用）
//   npm run eval                    → data/eval/testset.json で評価する
//   npm run eval -- <テストセット>   → 指定した JSON で評価する
//
// 流れ: テストセットを読む → 1問ずつ answerQuestion（チャットAPIと同じ RAG 本体）で回答
//       → 範囲内は Claude に要点を採点させ、範囲外は「該当なし」かを確認
//       → 正答率・出典付与率・該当なし率を集計し、reports/eval/ に Markdown と JSON を保存
//
// 前提: npm run ingest で PDF を取り込み済みであること。

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { answerQuestion } from "../../src/lib/chat/answer";
import { CLAUDE_MODEL, SIMILARITY_THRESHOLD, TOP_K } from "../../src/lib/chat/config";
import { judgeAnswer, JUDGE_MODEL } from "./judge";
import {
  allTargetsMet,
  buildMarkdown,
  formatRatio,
  summarize,
  type CaseResult,
  type RunInfo,
} from "./report";
import { loadTestSet, type TestCase } from "./testset";

config({ path: [".env.local", ".env"], quiet: true });

const DEFAULT_TESTSET = "data/eval/testset.json";
const REPORT_DIR = "reports/eval";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} が設定されていません（.env.local を確認）`);
  return value;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 1問を評価する。途中で失敗しても例外は投げず、status: "error" の結果として返す */
async function evaluateCase(supabase: SupabaseClient, tc: TestCase): Promise<CaseResult> {
  const started = Date.now();
  const base = { case: tc, sourceMatched: null, judgement: null, error: null };

  let response;
  try {
    response = await answerQuestion(supabase, tc.question);
  } catch (err) {
    return { ...base, status: "error", answer: "", sources: [], correct: false, error: errorMessage(err), elapsedMs: Date.now() - started };
  }
  const { status, answer, sources } = response;
  const done = (extra: Partial<CaseResult> & { correct: boolean }): CaseResult => ({
    ...base, status, answer, sources, elapsedMs: Date.now() - started, ...extra,
  });

  // 範囲外: 「該当なし」を返せたら正解。回答してしまったら不正解（採点は不要）
  if (tc.out_of_scope) return done({ correct: status === "not_found" });

  // 範囲内なのに「該当なし」: 不正解
  if (status === "not_found") return done({ correct: false });

  // 範囲内で回答した: 期待した根拠ページが出典に含まれるか（参考指標）
  const sourceMatched =
    tc.evidence.length === 0
      ? null
      : tc.evidence.some((e) => sources.some((s) => s.file_name === e.file_name && s.page === e.page));

  // 要点を Claude に採点させる。全要点を押さえていて、矛盾が無ければ正解
  try {
    const judgement = await judgeAnswer(tc.question, tc.expected_points, answer);
    const correct = judgement.points.every((p) => p.covered) && !judgement.contradicts;
    return done({ correct, sourceMatched, judgement });
  } catch (err) {
    return done({ status: "error", correct: false, sourceMatched, error: `採点に失敗: ${errorMessage(err)}` });
  }
}

function timestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  const testSetPath = process.argv[2] ?? DEFAULT_TESTSET;
  const cases = await loadTestSet(path.resolve(testSetPath));

  // service_role のクライアント（RLS をバイパス）。ローカル実行専用で、このキーは外に出さない
  const supabase = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  requireEnv("OPENAI_API_KEY");
  requireEnv("ANTHROPIC_API_KEY");

  const info: RunInfo = {
    startedAt: new Date(),
    testSetPath,
    topK: TOP_K,
    similarityThreshold: SIMILARITY_THRESHOLD,
    answerModel: CLAUDE_MODEL,
    judgeModel: JUDGE_MODEL,
  };
  console.log(`${cases.length} 問で評価します（${testSetPath}）\n`);

  // API のレート制限に引っかからないよう、1問ずつ順番に実行する
  const results: CaseResult[] = [];
  for (const [i, tc] of cases.entries()) {
    const result = await evaluateCase(supabase, tc);
    results.push(result);
    const icon = result.status === "error" ? "⚠" : result.correct ? "○" : "×";
    const scope = tc.out_of_scope ? "範囲外" : "範囲内";
    console.log(`${icon} [${i + 1}/${cases.length}] ${tc.id}（${scope}）${result.status} … ${tc.question}`);
    if (result.error) console.log(`    ${result.error}`);
  }

  const summary = summarize(results);
  console.log("\n===== 集計 =====");
  console.log(`正答率（範囲内）        : ${formatRatio(summary.accuracy)}  目標 80% 以上`);
  console.log(`出典付与率（回答したもの）: ${formatRatio(summary.sourceAttach)}  目標 100%`);
  console.log(`該当なし率（範囲外）    : ${formatRatio(summary.outOfScopeNotFound)}  目標 100%`);
  console.log(`参考: 範囲内なのに該当なし: ${formatRatio(summary.inScopeNotFound)}`);
  console.log(`参考: 出典が期待ページと一致: ${formatRatio(summary.sourceMatch)}`);
  console.log(`エラー: ${summary.errors} 件`);

  // レポートを保存（reports/ は .gitignore 済み。回答に社内文書の内容が含まれるのでコミットしない）
  await mkdir(REPORT_DIR, { recursive: true });
  const base = path.join(REPORT_DIR, `eval-${timestamp(info.startedAt)}`);
  await writeFile(`${base}.md`, buildMarkdown(info, summary, results), "utf8");
  await writeFile(`${base}.json`, JSON.stringify({ info, summary, results }, null, 2), "utf8");
  console.log(`\nレポート: ${base}.md`);

  if (!allTargetsMet(summary) || summary.errors > 0) {
    console.log("目標未達またはエラーがあります。レポートの「不正解・エラーの詳細」を確認してください。");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(errorMessage(err));
  process.exitCode = 1;
});
