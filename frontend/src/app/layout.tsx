import type { Metadata } from "next";
import "./globals.css";
import { cn } from "@/lib/utils";
import { LayoutProvider } from "@/components/Layout/LayoutContext";
import { NavigationSidebar } from "@/components/Layout/NavigationSidebar";
import { SQLCodePanel } from "@/components/Layout/SQLCodePanel";
import { ThemeProvider } from "@/components/ThemeProvider";

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
            <NavigationSidebar />
            <SQLCodePanel />
            {/* Main application container — full height for canvas, auto for home */}
            <div className="relative z-10 h-screen flex flex-col">
              {children}
            </div>
          </LayoutProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
