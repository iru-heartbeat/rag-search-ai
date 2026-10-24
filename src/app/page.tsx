import { Chat } from "@/components/Chat";
import { LogoutButton } from "@/components/LogoutButton";

// 未ログイン時の /login へのリダイレクトは src/proxy.ts（認証ブランチ）が担当する
export default function Home() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>社内文書検索AI</h1>
        <LogoutButton />
      </header>
      <main className="app-main">
        <Chat />
      </main>
    </div>
  );
}
