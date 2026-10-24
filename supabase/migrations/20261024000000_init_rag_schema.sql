-- 社内文書検索AI（RAG）MVP の初期スキーマ
--   documents : 取り込んだ PDF 1ファイル = 1行
--   chunks    : PDF をページ内で分割したテキスト断片 + 埋め込みベクトル
--   match_chunks(query_embedding, k) : 質問ベクトルに近いチャンクを上位 k 件返す RPC
--
-- 戻り値の型は src/lib/types.ts の MatchedChunk と一致させること。
-- ベクトル次元 1536 は EMBEDDING_DIMENSIONS（text-embedding-3-small）と一致させること。

-- ---------------------------------------------------------------------------
-- 1. 拡張機能
-- ---------------------------------------------------------------------------
-- pgvector。Supabase の推奨に従い public ではなく extensions スキーマに入れる。
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- 2. テーブル
-- ---------------------------------------------------------------------------
create table public.documents (
  id         uuid primary key default gen_random_uuid(),
  -- 取り込みスクリプトはこの列をキーに upsert する（同じファイルの再取り込みで重複させない）
  file_name  text not null unique,
  created_at timestamptz not null default now()
  -- Phase 2（部署別アクセス制御）では、ここに department 列を後から追加し、
  -- 下の RLS ポリシーを部署で絞る形に差し替える想定。
);

comment on table public.documents is '取り込み済み PDF（1ファイル1行）';

create table public.chunks (
  id          uuid primary key default gen_random_uuid(),
  -- 親の文書を消したらチャンクも消える（再取り込み時の掃除を簡単にする）
  document_id uuid not null references public.documents (id) on delete cascade,
  -- 出典表示に使う PDF のページ番号（1 始まり）。必ず保持する。
  page        integer not null check (page >= 1),
  content     text not null check (length(content) > 0),
  embedding   extensions.vector(1536) not null,
  created_at  timestamptz not null default now()
);

comment on table public.chunks is 'PDF のページ内チャンクと埋め込みベクトル';

-- ---------------------------------------------------------------------------
-- 3. インデックス
-- ---------------------------------------------------------------------------
-- 近似最近傍検索用の HNSW インデックス。コサイン距離（<=>）で検索するので vector_cosine_ops。
create index chunks_embedding_hnsw_idx
  on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- 文書単位の削除・再取り込み（document_id で絞る処理）を速くする
create index chunks_document_id_idx on public.chunks (document_id);

-- ---------------------------------------------------------------------------
-- 4. RLS（行レベルセキュリティ）
-- ---------------------------------------------------------------------------
-- MVP: 「ログイン済みユーザーは全件参照可」。書き込みポリシーは作らない。
--   → anon（未ログイン）は何も見えない
--   → 書き込みは RLS をバイパスする service_role（取り込みスクリプト）だけが可能
alter table public.documents enable row level security;
alter table public.chunks    enable row level security;

create policy "authenticated users can read documents"
  on public.documents
  for select
  to authenticated
  using (true);

create policy "authenticated users can read chunks"
  on public.chunks
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 5. 検索 RPC: match_chunks
-- ---------------------------------------------------------------------------
-- 戻り値は MatchedChunk（id, document_id, file_name, page, content, similarity）。
-- similarity = 1 - コサイン距離（1 に近いほど似ている）。
--
-- security invoker（既定）で定義し、呼び出したユーザーの権限で実行する。
-- こうすることで上の RLS がそのまま検索結果にも効き、Phase 2 で部署別ポリシーに
-- 変えたときも関数を書き換えずに済む。
create or replace function public.match_chunks(
  query_embedding extensions.vector(1536),
  k integer default 8
)
returns table (
  id          uuid,
  document_id uuid,
  file_name   text,
  page        integer,
  content     text,
  similarity  double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.document_id,
    d.file_name,
    c.page,
    c.content,
    1 - (c.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.chunks c
  join public.documents d on d.id = c.document_id
  -- 距離の昇順で並べると HNSW インデックスが使われる
  order by c.embedding operator(extensions.<=>) query_embedding
  -- 誤って巨大な k を渡されても負荷が跳ねないよう 1〜50 件に制限する
  limit least(greatest(coalesce(k, 8), 1), 50);
$$;

comment on function public.match_chunks(extensions.vector, integer)
  is '質問ベクトルにコサイン類似度が高いチャンクを上位 k 件（最大50）返す';

-- Supabase は新しい関数を anon にも実行可能にするので、ログイン済みユーザーと
-- service_role（評価スクリプト用）だけに絞る。
revoke execute on function public.match_chunks(extensions.vector, integer) from public, anon;
grant  execute on function public.match_chunks(extensions.vector, integer) to authenticated, service_role;
