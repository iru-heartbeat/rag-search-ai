import { SourceList } from "./SourceList";
import type { Turn } from "./types";

/** 1往復分（質問の吹き出し + 結果の吹き出し）を表示する */
export function ChatMessage({ turn }: { turn: Turn }) {
  const { result } = turn;

  return (
    <li className="turn">
      <div className="bubble bubble-question">{turn.question}</div>

      {result.kind === "pending" && (
        <div className="bubble bubble-answer bubble-pending">回答を作成しています…</div>
      )}

      {result.kind === "answered" && (
        <div className="bubble bubble-answer">
          <p className="answer-text">{result.answer}</p>
          <SourceList sources={result.sources} />
        </div>
      )}

      {result.kind === "not_found" && (
        <div className="bubble bubble-answer bubble-not-found">
          <p className="answer-text">{result.answer}</p>
          <p className="hint">質問の言い回しを変えるか、対象の文書名や用語を含めて再度お試しください。</p>
        </div>
      )}

      {result.kind === "error" && (
        <div className="bubble bubble-answer bubble-error" role="alert">
          <p className="answer-text">{result.message}</p>
          {result.status === 401 && (
            <p className="hint">
              ログインの有効期限が切れた可能性があります。<a href="/login">ログイン画面へ</a>
            </p>
          )}
        </div>
      )}
    </li>
  );
}
