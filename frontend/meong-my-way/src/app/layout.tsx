import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyWay — agentic career switching",
  description:
    "Upload your resume and let two agents map your current trajectory against realistic alternative career paths.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
