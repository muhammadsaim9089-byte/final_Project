"use client";

import { useEffect, useState, useCallback } from "react";
import styled, { keyframes } from "styled-components";

/* ── Animations ── */
const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`;

const fadeOut = keyframes`
  from { opacity: 1; }
  to   { opacity: 0; }
`;

const dash_682 = keyframes`
  72.5% { opacity: 0; }
  to    { stroke-dashoffset: 0; }
`;

/* ── Styled ── */
const Overlay = styled.div<{ $exiting: boolean }>`
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2rem;
  animation: ${({ $exiting }) => ($exiting ? fadeOut : fadeIn)} 0.35s ease forwards;
`;

const StyledWrapper = styled.div`
  .loading svg polyline {
    fill: none;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* ghost trail — same blue at low opacity */
  .loading svg polyline#back {
    fill: none;
    stroke: #1e549f33;
  }

  /* live stroke — project blue */
  .loading svg polyline#front {
    fill: none;
    stroke: #1e549f;
    stroke-dasharray: 48, 144;
    stroke-dashoffset: 192;
    animation: ${dash_682} 1.4s linear infinite;
  }
`;

const Wordmark = styled.p`
  font-family: "Vagnola", sans-serif;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  color: #0a1628;
  margin: 0;
  opacity: 0.8;
`;

/* ── Component ── */
interface CanvasLoaderProps {
  onComplete: () => void;
  totalMs?: number;
}

export function CanvasLoader({ onComplete, totalMs = 3400 }: CanvasLoaderProps) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), totalMs - 350);
    const doneTimer = setTimeout(() => onComplete(), totalMs);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(doneTimer);
    };
  }, [onComplete, totalMs]);

  return (
    <Overlay $exiting={exiting}>
      <StyledWrapper>
        <div className="loading">
          <svg width="64px" height="48px">
            <polyline
              points="0.157 23.954, 14 23.954, 21.843 48, 43 0, 50 24, 64 24"
              id="back"
            />
            <polyline
              points="0.157 23.954, 14 23.954, 21.843 48, 43 0, 50 24, 64 24"
              id="front"
            />
          </svg>
        </div>
      </StyledWrapper>

      <Wordmark>
        Design<span style={{ color: "#1e549f" }}>DB</span>
      </Wordmark>
    </Overlay>
  );
}
