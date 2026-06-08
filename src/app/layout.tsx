import type { Metadata } from "next";
import { Inter, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans-en",
  subsets: ["latin"],
  display: "swap",
});

const notoSansKr = Noto_Sans_KR({
  variable: "--font-sans-kr",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "제목 없는 스프레드시트 - Google Sheets",
  description: "Google Sheets",
  // 파비콘은 app/icon.png 파일을 Next가 자동으로 메타데이터로 연결한다.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${inter.variable} ${notoSansKr.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-[#202124]">
        {children}
      </body>
    </html>
  );
}
