import type { Source } from "@/lib/types";

/**
 * 出典の一覧を「ファイル名 p.N」の形で表示する。
 * 同じページから複数チャンクを引用していることがあるので、ファイル名 + ページで重複をまとめる。
 */
export function SourceList({ sources }: { sources: Source[] }) {
  const unique = sources.filter(
    (s, i) => sources.findIndex((t) => t.file_name === s.file_name && t.page === s.page) === i,
  );

  return (
    <div className="sources">
      <p className="sources-title">出典</p>
      <ul>
        {unique.map((s) => (
          <li key={`${s.file_name}#${s.page}`}>
            {s.file_name} p.{s.page}
          </li>
        ))}
      </ul>
    </div>
  );
}
