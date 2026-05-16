import type { Metadata } from "next";
import "./globals.css";
import { cn } from "@/lib/utils";

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
    <html lang="en" className={cn("dark")}>
      <body className="antialiased bg-[#001220] text-foreground overflow-x-hidden">
        {/* Main application container — full height for canvas, auto for home */}
        <div className="relative z-10 h-screen flex flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
