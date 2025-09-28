import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar, MobileSidebar } from "@/components/sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NEO 2BIZ MACHINE",
  description: "Modern UI dashboard powered by Next.js, Tailwind and shadcn/ui",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="min-h-screen w-full bg-background text-foreground">
          <div className="flex">
            <Sidebar />
            <div className="flex min-h-screen flex-1 flex-col">
              <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/80 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
                <MobileSidebar />
                <div className="text-sm font-medium">NEO 2BIZ MACHINE</div>
              </header>
              <main className="flex-1 p-4 md:p-6">
                {children}
              </main>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
