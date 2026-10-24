# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

社内文書検索AI（RAG）の MVP。MVP の機能はすべて実装済み（DB マイグレーション、取り込み、チャットAPI、認証、チャットUI、評価スクリプト）。Supabase（プロジェクト jissen3、東京）へ適用済み、サンプル PDF 5本を取り込み済み（評価: 正答率 90%）。GitHub: https://github.com/iru-heartbeat/rag-search-ai（公開）。Vercel 本番: https://rag-search-ai-five.vercel.app（main への push で自動デプロイ、リージョンは vercel.json の hnd1）。以下の「Architecture」は承認済みの実装プラン。実装したらこの記述を実態に合わせて更新すること。

要件の正は要件定義書（Claude Docs: https://claude.ai/artifact/U18Uw9gJhDRKEMFeA6ni2k、1〜7章が確定、8〜9章は未記入）。プラン原本: `C:\Users\irunt\.claude\plans\virtual-tickling-lerdorf.md`。

## Working rules

- 実装は1機能ずつ実行する。複数機能をまとめて進めない。
- 初心者の学習用案件のため、1機能を実装するたびに、実装した内容を分かりやすく説明する（使用した技術構成・採用理由・処理の流れまで含める）。

## Parallel development (git worktree)

3つの worktree で同時に開発している（第2ラウンド: 認証 / チャットUI / 評価）。各ブランチは**自分の担当パスだけ**を変更する（担当外のファイルは読むのは可、編集は不可）。

| ブランチ | worktree | 担当パス |
|---|---|---|
| `feat/auth` | `../rag-wt-auth` | `src/app/login/`, `src/app/auth/`, `src/proxy.ts`, `src/lib/supabase/`, `supabase/migrations/` の新規ファイル |
| `feat/chat-ui` | `../rag-wt-ui` | `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `src/components/` |
| `feat/eval` | `../rag-wt-eval` | `scripts/eval/`, `data/eval/` |

ブランチ間の取り決め:
- 型は `src/lib/types.ts`、埋め込みは `src/lib/embedding.ts`、RAG 本体は `src/lib/chat/answer.ts` の `answerQuestion(supabase, question)`。
  - チャットAPI はログイン中ユーザーの Supabase クライアントを、評価スクリプトは service_role のクライアントを渡す。
- 認証 ⇔ UI: 未ログインで `/` を開くと `/login` へリダイレクトする（`src/proxy.ts` が担当）。ログアウトは `<form action="/auth/signout" method="post">` で POST する（ルートは認証ブランチが作る）。`/api/*` はリダイレクトせず、route 側で 401 を返す。
- UI ⇔ チャットAPI: `POST /api/chat` に `{ question }` を送り、`ChatResponse` を受け取る。エラー時は `{ error: string }`（400/401/403/500/502）。
- 上記の共通ファイル、`src/app/api/chat/`、`src/lib/chat/`、CLAUDE.md、`package.json` は main でのみ変更する。変更が必要なら作業を止めてユーザーに相談する。
- 各ブランチは単独で `npx tsc --noEmit` が通る状態でコミットする。
- マージは main で `feat/auth` → `feat/chat-ui` → `feat/eval` の順に行う。

## Commands

`package.json` に定義済み:

```bash
npm run dev      # Next.js 開発サーバー
npm run build
npm run ingest   # PDF取り込み (tsx scripts/ingest/index.ts)
npm run eval     # テストセットによる精度評価 (tsx scripts/eval/index.ts)
```

lint / test ランナーは未導入。

## Architecture (planned)

- **スタック**: Next.js (App Router, TS) を Vercel（関数リージョン hnd1）、DB/認証は Supabase 東京リージョン。回答生成は Claude API、埋め込みは OpenAI `text-embedding-3-small`（1536次元）。
- **DB**: `documents`(file_name) と `chunks`(document_id, page, content, `vector(1536)`)。pgvector + HNSW(cosine)。検索は RPC `match_chunks(query_embedding, k)`。MVP の RLS は「認証済みユーザーのみ参照」、Phase 2 の部署別RLSのため `documents` に部署列を後付けできる構造にする。
- **取り込み (`scripts/ingest/`)**: PDF をページ単位で抽出 → ページ内で約500〜800字に分割（page 番号を必ず保持）→ 埋め込み → upsert。失敗ファイルは一覧で報告。`service_role` キーはローカル実行時のみ使用。
- **チャットAPI (`src/app/api/chat/route.ts`)**: 認証確認 → 質問を埋め込み → top-k 検索 → 類似度が閾値未満なら LLM を呼ばず「該当なし」 → Claude に文脈付きで質問（文脈外の知識・推測は禁止、根拠なしは「該当なし」、引用チャンクIDを返させる）→ 返却IDを取得済みチャンクと照合して「ファイル名 + ページ番号」を出典として付与。出典は取得済みチャンク由来のみ（LLM が自由記述した出典は使わない）。
- **認証**: Supabase Auth。社内メールドメイン制限は二重化（Supabase Auth Hook の before-user-created と API route 側の再検証）。

## Requirements that drive design

- 精度: 文書記載内容の質問で正答率 80% 以上。文書に無い判断・推論は必ず「該当なし」。
- 全回答に出典（ファイル名 + ページ番号）を100%付与。
- MVP は PDF 200本のみ。Word / Confluence / Slack / 差分更新 / 部署別アクセス制御は Phase 2（別見積もり）なので MVP に入れない。
- 秘密情報（`SUPABASE_*`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ALLOWED_EMAIL_DOMAIN`）は環境変数管理。`.env.example` を用意し、実値はコミットしない。
- 国内保存でも回答生成時に文書断片が外部 LLM API へ送信される点は、社内規程との整合を確認すべき未決事項。
