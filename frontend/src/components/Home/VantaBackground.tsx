"use client";

import { useEffect, useRef } from "react";

export function VantaBackground() {
  const vantaRef = useRef<HTMLDivElement>(null);
  const vantaEffect = useRef<any>(null);

  useEffect(() => {
    let mounted = true;

    async function initVanta() {
      const THREE = await import("three");
      // @ts-ignore - vanta has no types
      const VANTA = await import("vanta/dist/vanta.fog.min");

      if (!mounted || !vantaRef.current) return;

      vantaEffect.current = VANTA.default({
        el: vantaRef.current,
        THREE,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        minHeight: 200.0,
        minWidth: 200.0,
        highlightColor: 0x1e549f,
        midtoneColor: 0x052c52,
        lowlightColor: 0x000a14,
        baseColor: 0x001220,
        blurFactor: 0.52,
        speed: 1.5,
        zoom: 1.1,
      });
    }

    initVanta();

    return () => {
      mounted = false;
      if (vantaEffect.current) {
        vantaEffect.current.destroy();
        vantaEffect.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={vantaRef}
      className="fixed inset-0 w-full h-full -z-10"
      aria-hidden="true"
    />
  );
}
