"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, BookOpen } from "lucide-react";
import { CanvasLoader } from "./CanvasLoader";

export function HomeNavbar() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleOpenCanvas = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setLoading(true);
  }, []);

  const handleLoaderComplete = useCallback(() => {
    router.push("/canvas");
  }, [router]);

  return (
    <>
      {loading && <CanvasLoader onComplete={handleLoaderComplete} />}

      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-10 py-4"
        style={{
          background: "linear-gradient(180deg, rgba(0,18,32,0.75) 0%, rgba(0,18,32,0.0) 100%)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        {/* Logo mark */}
        <div className="flex items-center gap-2.5 select-none">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[#1e549f] to-[#052c52] shadow-[0_0_14px_rgba(30,84,159,0.5)] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5" height="5" rx="1" fill="rgba(255,255,255,0.8)" />
              <rect x="8" y="1" width="5" height="5" rx="1" fill="rgba(255,255,255,0.4)" />
              <rect x="1" y="8" width="5" height="5" rx="1" fill="rgba(255,255,255,0.4)" />
              <rect x="8" y="8" width="5" height="5" rx="1" fill="rgba(255,255,255,0.8)" />
            </svg>
          </div>
          <span className="text-white text-sm font-medium tracking-wide opacity-90">DesignDB</span>
        </div>

        {/* Nav links */}
        <div className="hidden md:flex items-center gap-8">
          {["Docs", "Examples", "Pricing"].map((item) => (
            <a
              key={item}
              href="#"
              className="text-[13px] text-white/50 hover:text-white/90 transition-colors duration-200 tracking-wide"
            >
              {item}
            </a>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/40 hover:text-white/80 transition-colors"
          >
            <ExternalLink size={17} />
          </a>
          <a href="#" className="text-white/40 hover:text-white/80 transition-colors">
            <BookOpen size={17} />
          </a>
          <button
            onClick={handleOpenCanvas}
            className="ml-2 px-4 py-1.5 rounded-md text-[12px] font-medium tracking-wide text-white transition-all duration-200 cursor-pointer"
            style={{
              background: "linear-gradient(135deg, rgba(30,84,159,0.6) 0%, rgba(5,44,82,0.6) 100%)",
              border: "1px solid rgba(30,84,159,0.4)",
              boxShadow: "0 0 12px rgba(30,84,159,0.2)",
            }}
          >
            Open Canvas →
          </button>
        </div>
      </nav>
    </>
  );
}
