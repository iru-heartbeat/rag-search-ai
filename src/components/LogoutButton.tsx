/**
 * ログアウトボタン。CLAUDE.md の取り決めどおり /auth/signout に POST する。
 * （ルート本体は認証ブランチ feat/auth が作る）
 * 普通の form 送信なので JavaScript が無くても動く。
 */
export function LogoutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button type="submit" className="logout">
        ログアウト
      </button>
    </form>
  );
}
