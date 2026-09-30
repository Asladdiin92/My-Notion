import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Dashboard",
  description: "Your Notion-powered academic and life dashboard.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><ClerkProvider>{children}</ClerkProvider></body>
    </html>
  );
}
