import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "BizContent AI | 우리 가게의 콘텐츠 파트너",
  description: "한국 소상공인을 위한 AI 콘텐츠 마케팅 워크스페이스",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
