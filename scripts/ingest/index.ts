// PDF 取り込みスクリプト（ローカル実行専用）
//   npm run ingest              → data/pdfs/ 直下の PDF を全件取り込む
//   npm run ingest -- <フォルダ>  → 指定フォルダの PDF を取り込む
//
// 流れ: PDF をページ単位で抽出 → ページ内で 500〜800 字に分割 → 埋め込み → DB へ upsert
// 同じファイル名を再取り込みすると、そのファイルのチャンクは丸ごと入れ替わる。

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { embedTexts } from "../../src/lib/embedding";
import type { ChunkInsert } from "../../src/lib/types";
import { splitIntoChunks } from "./chunk";
import { extractPages } from "./extract";

config({ path: [".env.local", ".env"], quiet: true });

const DEFAULT_PDF_DIR = "data/pdfs";
/** OpenAI へ1回で送るテキスト数 */
const EMBED_BATCH_SIZE = 100;
/** Supabase へ1回で insert する行数（1行に1536次元のベクトルが入るので控えめに） */
const INSERT_BATCH_SIZE = 100;

type FileResult = { chunks: number; pages: number; emptyPages: number[] };
type Failure = { file: string; reason: string };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} が設定されていません（.env.local を確認）`);
  return value;
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function listPdfFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "ja"));
}

/** 1ファイルを取り込む。失敗したら例外を投げる（呼び出し側で失敗一覧に積む） */
async function ingestFile(supabase: SupabaseClient, filePath: string, fileName: string): Promise<FileResult> {
  // 1. ページごとにテキスト抽出 → ページ内で分割（page 番号はここで紐づけて以降保持する）
  const pages = await extractPages(new Uint8Array(await readFile(filePath)));
  const emptyPages: number[] = [];
  const pieces: { page: number; content: string }[] = [];
  for (const { page, text } of pages) {
    const chunks = splitIntoChunks(text);
    if (chunks.length === 0) emptyPages.push(page);
    for (const content of chunks) pieces.push({ page, content });
  }
  if (pieces.length === 0) {
    throw new Error("テキストを抽出できませんでした（スキャン画像の PDF の可能性があります）");
  }

  // 2. 埋め込み（DB を触る前に済ませ、API エラーで中途半端な状態を作らない）
  const embeddings: number[][] = [];
  for (const batch of chunked(pieces, EMBED_BATCH_SIZE)) {
    embeddings.push(...(await embedTexts(batch.map((p) => p.content))));
  }

  // 3. documents を file_name で upsert して id を得る
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .upsert({ file_name: fileName }, { onConflict: "file_name" })
    .select("id")
    .single();
  if (docError || !doc) throw new Error(`documents の upsert に失敗: ${docError?.message ?? "id が返りません"}`);
  const documentId: string = doc.id;

  // 4. 既存チャンクを消してから入れ直す（再取り込みで重複させない）
  const { error: deleteError } = await supabase.from("chunks").delete().eq("document_id", documentId);
  if (deleteError) throw new Error(`既存チャンクの削除に失敗: ${deleteError.message}`);

  const rows: ChunkInsert[] = pieces.map((p, i) => ({
    document_id: documentId,
    page: p.page,
    content: p.content,
    embedding: embeddings[i],
  }));
  for (const batch of chunked(rows, INSERT_BATCH_SIZE)) {
    const { error } = await supabase.from("chunks").insert(batch);
    if (error) throw new Error(`chunks の insert に失敗（再実行で入れ直されます）: ${error.message}`);
  }

  return { chunks: rows.length, pages: pages.length, emptyPages };
}

async function main() {
  const pdfDir = path.resolve(process.argv[2] ?? DEFAULT_PDF_DIR);
  const supabase = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  requireEnv("OPENAI_API_KEY");

  const files = await listPdfFiles(pdfDir);
  if (files.length === 0) {
    console.log(`PDF が見つかりません: ${pdfDir}`);
    return;
  }
  console.log(`${files.length} 件の PDF を取り込みます（${pdfDir}）\n`);

  const failures: Failure[] = [];
  let totalChunks = 0;

  for (const [i, fileName] of files.entries()) {
    const label = `[${i + 1}/${files.length}] ${fileName}`;
    try {
      const result = await ingestFile(supabase, path.join(pdfDir, fileName), fileName);
      totalChunks += result.chunks;
      console.log(`✓ ${label} … ${result.pages} ページ / ${result.chunks} チャンク`);
      if (result.emptyPages.length > 0) {
        console.log(`    ⚠ 文字のないページ（画像のみ?）: ${result.emptyPages.join(", ")}`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push({ file: fileName, reason });
      console.log(`✗ ${label} … ${reason}`);
    }
  }

  console.log(`\n完了: 成功 ${files.length - failures.length} 件 / 失敗 ${failures.length} 件 / 合計 ${totalChunks} チャンク`);
  if (failures.length > 0) {
    console.log("\n失敗したファイル:");
    for (const f of failures) console.log(`  - ${f.file}: ${f.reason}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
