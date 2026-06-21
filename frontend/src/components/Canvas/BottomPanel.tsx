import { ChevronUp, ChevronDown, Sparkles, Code2 } from 'lucide-react';

interface BottomPanelProps {
  isSqlOpen: boolean;
  setIsSqlOpen: (open: boolean) => void;
  isReviewsOpen: boolean;
  setIsReviewsOpen: (open: boolean) => void;
  sql?: string;
}

export function BottomPanel({ isSqlOpen, setIsSqlOpen, isReviewsOpen, setIsReviewsOpen, sql }: BottomPanelProps) {
  const displaySql = sql || `-- Synthesizing architecture...\n-- Please wait a moment while DesignDB generates your schema.`;

  return null;
}

