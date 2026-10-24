import type { Metadata } from "next";
import { safeNextPath } from "@/app/auth/next-path";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "ログイン | 社内文書検索AI",
};

// /auth/callback からエラーで戻されたときに表示するメッセージ
const ERROR_MESSAGES: Record<string, string> = {
  link_invalid: "ログインリンクが無効か、有効期限が切れています。もう一度リンクを送信してください。",
  domain_not_allowed: "このメールアドレスでは利用できません。社内のメールアドレスでログインしてください。",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <main className={styles.container}>
      <h1 className={styles.title}>社内文書検索AI</h1>
      <p className={styles.lead}>社内メールアドレスに届くリンクからログインします。</p>
      {errorMessage && (
        <p className={styles.error} role="alert">
          {errorMessage}
        </p>
      )}
      <LoginForm next={safeNextPath(next)} />
    </main>
  );
}
