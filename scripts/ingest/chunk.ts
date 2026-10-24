/** チャンクの目標文字数。この範囲に収まるよう文の切れ目で区切る */
export const MIN_CHUNK_CHARS = 500;
export const MAX_CHUNK_CHARS = 800;

/**
 * NFKC で戻らない「CJK部首補助」の文字（U+2E80〜U+2EFF）と、対応する通常の漢字。
 * PDF によっては「長」「民」などがこの部首用の文字として埋め込まれている。
 */
const CJK_RADICAL_SUPPLEMENT: Record<string, string> = {
  "⺟": "母", "⺠": "民", "⻁": "虎", "⻄": "西", "⻆": "角", "⻑": "長",
  "⻘": "青", "⻝": "食", "⻤": "鬼", "⻩": "黄", "⻭": "歯", "⻲": "亀",
};

/** PDF 由来の文字の揺れと、余計な空白・空行を整える */
export function normalizeText(text: string): string {
  return text
    // 「⽇」(U+2F47 康熙部首) → 「日」のように、見た目が同じ別の文字を通常の漢字にそろえる。
    // そろえないと、普通の漢字で書かれた質問と一致せず検索精度が落ちる
    .normalize("NFKC")
    .replace(/[⺀-⻿]/g, (ch) => CJK_RADICAL_SUPPLEMENT[ch] ?? ch)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t　]+/g, " ") // 連続する空白（全角含む）を1つに
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // 3行以上の空行は1つの段落区切りに
    .trim();
}

/** 文（句点・改行）単位に分ける。区切り文字は前の文に残す */
function splitSentences(text: string): string[] {
  return text.match(/[^。．！？!?\n]*(?:[。．！？!?]+|\n+|$)/g)?.filter((s) => s.length > 0) ?? [];
}

/** 上限を超える長文は強制的に上限文字数ごとに切る */
function hardSplit(sentence: string, max: number): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < sentence.length; i += max) pieces.push(sentence.slice(i, i + max));
  return pieces;
}

/**
 * 1ページ分のテキストを 500〜800 字程度のチャンクに分ける。
 * ページをまたいで結合しないので、各チャンクのページ番号は常に1つに決まる。
 */
export function splitIntoChunks(pageText: string): string[] {
  const text = normalizeText(pageText);
  if (!text) return [];

  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  for (const sentence of splitSentences(text)) {
    for (const piece of hardSplit(sentence, MAX_CHUNK_CHARS)) {
      // 足すと上限を超えるなら、先に今のチャンクを確定させる
      if (current.length + piece.length > MAX_CHUNK_CHARS) flush();
      current += piece;
      // 下限に達したら文の切れ目で確定
      if (current.length >= MIN_CHUNK_CHARS) flush();
    }
  }

  // ページ末尾の短い残りは、入るなら直前のチャンクに合流させる
  const rest = current.trim();
  if (rest) {
    const last = chunks.at(-1);
    if (last !== undefined && last.length + 1 + rest.length <= MAX_CHUNK_CHARS) {
      chunks[chunks.length - 1] = `${last}\n${rest}`;
    } else {
      chunks.push(rest);
    }
  }
  return chunks;
}
