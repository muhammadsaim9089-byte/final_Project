import { Canvas } from "@/components/Canvas/Canvas";
import { ReactFlowProvider } from "@xyflow/react";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

export const metadata = {
  title: "DesignDB — Canvas",
  description: "Visual database schema editor with real-time ERD generation.",
};

export default function CanvasPage() {
  return (
    <main className="w-full h-full relative">
      <ReactFlowProvider>
        <ErrorBoundary>
          <Canvas />
        </ErrorBoundary>
      </ReactFlowProvider>
    </main>
  );
}
