/**
 * ログイン後の戻り先（?next=...）を安全な値に正規化する。
 *
 * 外部 URL（"https://evil.example" や "//evil.example"）を受け付けると、
 * ログイン直後に偽サイトへ飛ばされる「オープンリダイレクト」脆弱性になる。
 * そのため「/ で始まる同一サイト内のパス」だけを許可し、それ以外は "/" にする。
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return "/";
  // "//host" や "/\host" はブラウザが別ホストとして解釈するので拒否
  if (next.startsWith("//") || next.startsWith("/\\")) return "/";
  // ログイン画面・認証ルートへ戻すとループするので拒否
  if (next.startsWith("/login") || next.startsWith("/auth/")) return "/";
  return next;
}
