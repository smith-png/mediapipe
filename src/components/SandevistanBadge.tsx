interface SandevistanBadgeProps {
  active: boolean;
}

export function SandevistanBadge({ active }: SandevistanBadgeProps) {
  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed top-4 left-4 z-30 select-none"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="bg-[#06070b]/75 backdrop-blur-sm border border-[#00f0ff]/45 px-3 py-1.5 shadow-[0_0_24px_rgba(0,240,255,0.28)]">
        <span
          data-text="SANDEVISTAN ACTIVATED"
          className="sandy-glitch font-display text-sm sm:text-base font-bold tracking-[0.18em] text-[#f8fafc] whitespace-nowrap"
        >
          SANDEVISTAN ACTIVATED
        </span>
      </div>
    </div>
  );
}
