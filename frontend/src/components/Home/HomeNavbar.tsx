"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, BookOpen } from "lucide-react";
import { CanvasLoader } from "./CanvasLoader";

export function HomeNavbar() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Prefetch the canvas page so it loads instantly after the loader animation
  useEffect(() => {
    router.prefetch("/canvas");
  }, [router]);

  const handleOpenCanvas = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setLoading(true);
  }, []);

  const handleLoaderComplete = useCallback(() => {
    router.replace("/canvas");
  }, [router]);

  return (
    <>
      {loading && <CanvasLoader onComplete={handleLoaderComplete} />}

      <div className="fixed top-6 left-0 right-0 z-50 px-6 md:px-12 flex justify-center pointer-events-none">
        <nav
          className="pointer-events-auto flex items-center justify-between w-full max-w-5xl h-14 rounded-full bg-[#030712]/75 backdrop-blur-xl border border-white/[0.08] px-8 shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-300"
        >
          {/* Logo mark */}
          <div className="flex items-center gap-2.5 select-none cursor-pointer" onClick={() => router.push("/")}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-lime-green to-[#0f2d12] shadow-[0_0_12px_rgba(194,239,78,0.25)] flex items-center justify-center border border-lime-green/20">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" fill="#C2EF4E" />
                <rect x="8" y="1.5" width="4.5" height="4.5" rx="1" fill="rgba(194,239,78,0.4)" />
                <rect x="1.5" y="8" width="4.5" height="4.5" rx="1" fill="rgba(194,239,78,0.4)" />
                <rect x="8" y="8" width="4.5" height="4.5" rx="1" fill="#C2EF4E" />
              </svg>
            </div>
            <span className="text-white text-[15px] font-bold tracking-wide select-none" style={{ fontFamily: "Vagnola, sans-serif" }}>
              Design<span className="text-lime-green">DB</span>
            </span>
          </div>

          {/* Nav links */}
          <div className="hidden md:flex items-center gap-8">
            {["Docs", "Examples", "Pricing"].map((item) => (
              <a
                key={item}
                href="#"
                className="text-xs text-white/65 hover:text-white transition-colors duration-200 tracking-wide font-medium"
              >
                {item}
              </a>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-4.5">
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/65 hover:text-white transition-colors duration-200"
            >
              <ExternalLink size={16} />
            </a>
            <a href="#" className="text-white/65 hover:text-white transition-colors duration-200">
              <BookOpen size={16} />
            </a>
            <button
              onClick={handleOpenCanvas}
              className="px-4.5 py-2 rounded-full text-xs font-bold tracking-wide text-[#030712] bg-lime-green hover:bg-lime-green/90 transition-all duration-200 shadow-[0_4px_16px_rgba(194,239,78,0.25)] hover:scale-[1.03] active:scale-[0.98] cursor-pointer"
            >
              Open Canvas
            </button>
          </div>
        </nav>
      </div>
    </>
  );
}
