import type { ReactNode } from "react";

export const metadata = {
  title: "社内文書検索AI",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
