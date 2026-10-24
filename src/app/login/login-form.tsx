"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";
import styles from "./login.module.css";

const initialState: LoginState = { status: "idle" };

/**
 * メールアドレス入力フォーム。
 * useActionState で Server Action の結果（送信済み / エラー）を受け取り、画面を切り替える。
 */
export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(sendMagicLink, initialState);

  if (state.status === "sent") {
    return (
      <p className={styles.success} role="status">
        <strong>{state.email}</strong> にログイン用のリンクを送信しました。
        <br />
        メールを開き、<strong>このブラウザで</strong>リンクをクリックしてください。
      </p>
    );
  }

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className={styles.label}>
        社内メールアドレス
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.co.jp"
        className={styles.input}
        disabled={pending}
      />
      <button type="submit" className={styles.button} disabled={pending}>
        {pending ? "送信中…" : "ログインリンクを送る"}
      </button>
      {state.status === "error" && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
