/** チャンクの目標文字数。この範囲に収まるよう文の切れ目で区切る */
export const MIN_CHUNK_CHARS = 500;
export const MAX_CHUNK_CHARS = 800;

/** PDF 由来の余計な空白・空行を整える */
export function normalizeText(text: string): string {
  return text
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
