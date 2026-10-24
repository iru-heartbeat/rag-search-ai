"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatResponse } from "@/lib/types";
import { MAX_QUESTION_LENGTH } from "@/lib/chat/config";
import { ChatMessage } from "./ChatMessage";
import type { Turn } from "./types";

/** POST /api/chat を呼び、結果を Turn["result"] の形に変換する */
async function ask(question: string): Promise<Turn["result"]> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
  } catch {
    return { kind: "error", status: null, message: "サーバーに接続できませんでした。通信環境を確認してください。" };
  }

  // 本文が JSON でない場合（プロキシのエラーページなど）にも落ちないようにする
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      typeof (body as { error?: unknown } | null)?.error === "string"
        ? (body as { error: string }).error
        : `エラーが発生しました（${res.status}）`;
    return { kind: "error", status: res.status, message };
  }

  const data = body as ChatResponse;
  if (data?.status === "answered") {
    return { kind: "answered", answer: data.answer, sources: data.sources };
  }
  if (data?.status === "not_found") {
    return { kind: "not_found", answer: data.answer };
  }
  return { kind: "error", status: res.status, message: "サーバーから想定外の応答が返りました。" };
}

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const nextId = useRef(1);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isPending = turns.some((t) => t.result.kind === "pending");
  const trimmed = input.trim();
  const tooLong = trimmed.length > MAX_QUESTION_LENGTH;
  const canSend = !isPending && trimmed.length > 0 && !tooLong;

  // 新しいメッセージが増えたら一番下までスクロールする
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  async function send() {
    if (!canSend) return;
    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, question: trimmed, result: { kind: "pending" } }]);
    setInput("");

    const result = await ask(trimmed);
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, result } : t)));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  // Enter で送信、Shift+Enter で改行。日本語変換の確定 Enter では送信しない
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="chat">
      <div className="chat-log">
        {turns.length === 0 ? (
          <p className="empty">社内文書について質問してください。回答には根拠となる文書名とページ番号が付きます。</p>
        ) : (
          <ul>
            {turns.map((t) => (
              <ChatMessage key={t.id} turn={t} />
            ))}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-form" onSubmit={onSubmit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="例: 有給休暇の申請期限は？（Enter で送信 / Shift+Enter で改行）"
          rows={3}
          aria-label="質問"
        />
        <div className="chat-form-footer">
          <span className={tooLong ? "count count-over" : "count"}>
            {trimmed.length} / {MAX_QUESTION_LENGTH}
          </span>
          <button type="submit" disabled={!canSend}>
            {isPending ? "回答中…" : "送信"}
          </button>
        </div>
      </form>
    </div>
  );
}
