import path from "node:path";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

/** 1ページ分の抽出結果。page は 1 始まり（PDF ビューアの表示と同じ番号） */
export type PageText = {
  page: number;
  text: string;
};

// 日本語 PDF のフォント情報（CMap）と標準フォントは pdfjs-dist に同梱されている。
// Node から読むときはファイルパス（末尾スラッシュ付き）で場所を教える。
const PDFJS_DIR = path.dirname(require.resolve("pdfjs-dist/package.json"));
const toDirUrl = (dir: string) => path.join(PDFJS_DIR, dir).replaceAll("\\", "/") + "/";

/** PDF をページごとのテキストに変換する */
export async function extractPages(data: Uint8Array): Promise<PageText[]> {
  const loadingTask = getDocument({
    data,
    cMapUrl: toDirUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: toDirUrl("standard_fonts"),
    verbosity: VerbosityLevel.ERRORS, // フォント関連の細かい警告を抑える
  });

  try {
    const doc = await loadingTask.promise;
    const pages: PageText[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue; // マーク情報など文字以外の要素は無視
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      pages.push({ page: i, text });
      page.cleanup();
    }
    return pages;
  } finally {
    await loadingTask.destroy(); // 読み込み途中で失敗しても後始末する
  }
}
