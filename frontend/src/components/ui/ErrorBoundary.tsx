"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught canvas error:", error, errorInfo);
  }

  private handleReset = () => {
    try {
      const saved = localStorage.getItem("designdb_crash_recovery");
      if (saved) {
        sessionStorage.setItem("designdb_restore_recovery", saved);
      }
    } catch (e) {
      console.error("Crash recovery failed:", e);
    }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-screen bg-[#050712] flex items-center justify-center p-6 text-white font-sans">
          <div className="bg-[#0C1222]/90 border border-red-500/20 p-8 rounded-2xl shadow-2xl max-w-md w-full flex flex-col items-center text-center gap-5">
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 animate-bounce">
              <AlertTriangle size={32} />
            </div>
            <div>
              <h2 className="text-xl font-bold mb-2">Canvas Error Detected</h2>
              <p className="text-white/60 text-xs leading-relaxed">
                An unexpected error occurred while rendering the interactive database canvas. Don&apos;t worry, your workspace is auto-saved!
              </p>
            </div>
            <button
              onClick={this.handleReset}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#4A90D9] hover:bg-[#4A90D9]/90 text-white text-xs font-bold rounded-xl transition-all shadow-[0_4px_12px_rgba(74,144,217,0.2)] w-full"
            >
              <RotateCcw size={14} />
              Restore & Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
