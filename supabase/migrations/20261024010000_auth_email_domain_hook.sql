-- 社内メールドメイン制限（二重化の1段目）: Supabase Auth の before-user-created Hook
--
-- ユーザーが新規作成される直前に Supabase Auth がこの関数を呼ぶ。
--   - 許可ドメインのメール → {} を返して作成を許可
--   - それ以外             → {"error": {...}} を返して作成を拒否（signInWithOtp がエラーになる）
-- 2段目は API route / ログインのコールバック側の isAllowedEmail（src/lib/chat/auth.ts）。
--
-- ■ 適用後に手動で必要な作業（マイグレーションだけでは Hook は動かない）
--   1. 許可ドメインを登録する（ALLOWED_EMAIL_DOMAIN と同じ値にすること）:
--        insert into public.allowed_email_domains (domain) values ('example.co.jp');
--   2. Dashboard > Authentication > Hooks で "Before User Created" を有効化し、
--      Postgres 関数 public.hook_before_user_created を選ぶ。
--
-- 許可ドメインが1件も登録されていなければ「全員拒否」になる（設定漏れで全開放にならないように）。

-- ---------------------------------------------------------------------------
-- 1. 許可ドメインの一覧
-- ---------------------------------------------------------------------------
-- 社名ドメインをマイグレーション（= Git）に直書きしないよう、テーブルで管理する。
-- 複数ドメイン（グループ会社など）にもそのまま対応できる。
create table public.allowed_email_domains (
  -- 小文字・"@" なしで保存する（例: example.co.jp）
  domain     text primary key
             check (domain = lower(domain) and domain !~ '[@[:space:]]' and length(domain) > 0),
  created_at timestamptz not null default now()
);

comment on table public.allowed_email_domains
  is 'サインアップを許可するメールドメイン（before-user-created Hook が参照）';

-- アプリ（anon / authenticated）からは一切見えない・触れないようにする。
-- RLS を有効にしてポリシーを作らない = 全行拒否。Hook を実行する supabase_auth_admin だけ読める。
alter table public.allowed_email_domains enable row level security;

revoke all on table public.allowed_email_domains from public, anon, authenticated;
grant select on table public.allowed_email_domains to supabase_auth_admin;

create policy "auth admin can read allowed domains"
  on public.allowed_email_domains
  as permissive
  for select
  to supabase_auth_admin
  using (true);

-- ---------------------------------------------------------------------------
-- 2. Hook 関数
-- ---------------------------------------------------------------------------
-- event の形（抜粋）: { "metadata": {...}, "user": { "email": "...", ... } }
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  -- 変数名に v_ を付けるのは、テーブルの列名 domain と衝突させないため
  v_email  text := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
  v_domain text;
begin
  -- "@" がちょうど1つで、その後ろがドメイン。メールが無い（電話番号・匿名ログイン等）なら拒否
  if v_email !~ '^[^@]+@[^@]+$' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Only company email addresses are allowed.'
      )
    );
  end if;

  v_domain := split_part(v_email, '@', 2);

  -- 完全一致で判定する（"evil-example.co.jp" や "example.co.jp.evil.com" を通さない）
  if exists (select 1 from public.allowed_email_domains a where a.domain = v_domain) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Only company email addresses are allowed.'
    )
  );
end;
$$;

comment on function public.hook_before_user_created(jsonb)
  is 'before-user-created Auth Hook: allowed_email_domains に無いドメインのユーザー作成を拒否する';

-- Supabase Auth（supabase_auth_admin）だけが実行できるようにする。
-- アプリから RPC で呼ばれて許可ドメインを探られることがないよう、他のロールからは剥奪する。
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
