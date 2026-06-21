"use client";

import { cn } from "@/lib/utils";
import { IconLayoutNavbarCollapse } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

export interface DockItem {
  title: string;
  icon: React.ReactNode;
  href: string;
  onClick?: () => void;
  isActive?: boolean;
}

export const FloatingDock = ({
  items,
  desktopClassName,
  mobileClassName,
}: {
  items: DockItem[];
  desktopClassName?: string;
  mobileClassName?: string;
}) => {
  return (
    <>
      <FloatingDockDesktop items={items} className={desktopClassName} />
      <FloatingDockMobile items={items} className={mobileClassName} />
    </>
  );
};

const FloatingDockMobile = ({
  items,
  className,
}: {
  items: DockItem[];
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("relative block md:hidden", className)}>
      <AnimatePresence>
        {open && (
          <motion.div
            layoutId="nav"
            className="absolute inset-y-0 left-full ml-2 flex flex-row gap-2"
          >
            {items.map((item, idx) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{
                  opacity: 0,
                  x: -10,
                  transition: { delay: idx * 0.05 },
                }}
                transition={{ delay: (items.length - 1 - idx) * 0.05 }}
              >
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    item.onClick?.();
                  }}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full",
                    item.isActive ? "bg-[#4A90D9]/20 text-[#4A90D9]" : "bg-white/5 text-white/70"
                  )}
                >
                  <div className="h-4 w-4">{item.icon}</div>
                </button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <button
        onClick={() => setOpen(!open)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70"
      >
        <IconLayoutNavbarCollapse className="h-5 w-5" />
      </button>
    </div>
  );
};

const FloatingDockDesktop = ({
  items,
  className,
}: {
  items: DockItem[];
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "my-auto hidden w-[52px] flex-col items-center justify-center gap-2 rounded-full bg-[#030712]/90 backdrop-blur-[12px] border border-white/10 py-3 md:flex shadow-[0_8px_32px_rgba(0,0,0,0.4)]",
        className,
      )}
    >
      {items.map((item) => (
        <IconContainer key={item.title} {...item} />
      ))}
    </div>
  );
};

function IconContainer({
  title,
  icon,
  href,
  onClick,
  isActive,
}: {
  title: string;
  icon: React.ReactNode;
  href: string;
  onClick?: () => void;
  isActive?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div className="relative group">
      <a href={onClick ? undefined : href} onClick={handleClick} className="cursor-pointer block">
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200",
            isActive
              ? "bg-[#4A90D9]/20 text-[#4A90D9]"
              : "text-[#4A90D9]/80 hover:bg-white/10 hover:text-[#4A90D9] active:bg-black/40"
          )}
        >
          <div className="flex items-center justify-center w-5 h-5">
            {icon}
          </div>
        </div>
      </a>
      
      {/* Tooltip */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, x: 0 }}
            animate={{ opacity: 1, x: 10 }}
            exit={{ opacity: 0, x: 0 }}
            className="absolute left-full top-1/2 -translate-y-1/2 w-fit rounded-md border border-white/10 bg-[#0C1520]/95 px-3 py-1.5 text-[11px] font-medium tracking-wide whitespace-pre text-white shadow-ambient pointer-events-none z-50 ml-2"
          >
            {title}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
