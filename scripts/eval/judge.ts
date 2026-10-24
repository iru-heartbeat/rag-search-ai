// 採点役（LLM-as-a-judge）。
// 「期待する要点」と RAG の回答を Claude に見比べさせ、要点ごとに押さえているかを判定する。
// 言い回しが違っても意味が同じなら OK にしたいので、文字列一致ではなく LLM で採点する。

import Anthropic from "@anthropic-ai/sdk";

/** 採点に使うモデル（回答生成のモデルとは別に決めてよい） */
export const JUDGE_MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export type PointJudgement = { point: string; covered: boolean };

export type Judgement = {
  points: PointJudgement[];
  /** 期待する要点と食い違う内容（誤った数値・逆の結論など）を含むか */
  contradicts: boolean;
  /** 判定理由（レポートで人が確認する用） */
  reason: string;
};

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    points: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, covered: { type: "boolean" } },
        required: ["index", "covered"],
        additionalProperties: false,
      },
    },
    contradicts: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["points", "contradicts", "reason"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `あなたは社内文書検索システムの回答を採点する担当です。
質問・期待する答えの要点・システムの回答を受け取り、要点ごとに回答が押さえているかを判定します。

判定基準:
- 言い回しが違っても、意味が同じなら covered を true にしてください。
- 数値・期限・条件などが要点と違う、または曖昧にしか書かれていない場合は covered を false にしてください。
- 要点と矛盾する内容（誤った数値、逆の結論など）が回答に含まれていれば contradicts を true にしてください。要点に無い補足があるだけなら矛盾ではありません。
- points には、渡した要点すべてについて index（0 始まり）と covered を1件ずつ入れてください。
- reason には判定理由を日本語で1〜2文で書いてください。`;

function buildUserMessage(question: string, expectedPoints: string[], answer: string): string {
  const points = expectedPoints.map((p, i) => `<point index="${i}">${p}</point>`).join("\n");
  return `<question>\n${question}\n</question>\n\n<expected_points>\n${points}\n</expected_points>\n\n<answer>\n${answer}\n</answer>`;
}

export async function judgeAnswer(question: string, expectedPoints: string[], answer: string): Promise<Judgement> {
  const response = await getClient().beta.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 16000,
    // 安全分類器が誤って拒否したとき、サーバー側で別モデルに自動で切り替える
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: JUDGE_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(question, expectedPoints, answer) }],
  });

  if (response.stop_reason === "refusal") throw new Error("採点が拒否されました");
  if (response.stop_reason === "max_tokens") throw new Error("採点の出力が途中で切れました");

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(text) as {
    points: { index: number; covered: boolean }[];
    contradicts: boolean;
    reason: string;
  };

  // 採点役が要点を飛ばしても「押さえていない」扱いにする（甘く採点しない）
  const coveredByIndex = new Map(parsed.points.map((p) => [p.index, p.covered]));
  return {
    points: expectedPoints.map((point, i) => ({ point, covered: coveredByIndex.get(i) === true })),
    contradicts: parsed.contradicts,
    reason: parsed.reason,
  };
}
