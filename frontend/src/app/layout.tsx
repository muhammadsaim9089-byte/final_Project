import type { Metadata } from "next";
import "./globals.css";
import { LayoutProvider } from "@/components/Layout/LayoutContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppLayout } from "@/components/Layout/AppLayout";

export const metadata: Metadata = {
  title: "DesignDB | Ethereal Engine",
  description: "High-Performance Node Interface for Database Architecture",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-slate-950 dark:bg-[#001220] text-foreground overflow-x-hidden transition-colors duration-200" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
          <LayoutProvider>
            <AppLayout>{children}</AppLayout>
          </LayoutProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}


