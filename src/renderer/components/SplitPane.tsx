import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useUIStore } from '@renderer/store/uiStore';

interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
}

export const SplitPane = ({
  left,
  right,
  leftCollapsed = false,
  rightCollapsed = false,
}: SplitPaneProps) => {
  const leftWidth = useUIStore((state) => state.leftPaneWidth);
  const setLeftWidth = useUIStore((state) => state.setLeftPaneWidth);
  const [dragging, setDragging] = useState(false);

  const startDrag = useCallback(() => setDragging(true), []);
  const stopDrag = useCallback(() => setDragging(false), []);

  const onMove = useCallback(
    (event: React.MouseEvent) => {
      if (!dragging) return;
      const parent = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
      const next = ((event.clientX - parent.left) / parent.width) * 100;
      const clamped = Math.max(50, Math.min(80, next));
      setLeftWidth(clamped);
      window.dispatchEvent(new Event('resize'));
    },
    [dragging, setLeftWidth]
  );

  const leftStyle = useMemo(() => ({ width: `${leftWidth}%` }), [leftWidth]);
  const rightStyle = useMemo(() => ({ width: `${100 - leftWidth}%` }), [leftWidth]);

  if (leftCollapsed) {
    return <div className="h-full min-h-0 w-full min-w-0">{right}</div>;
  }

  if (rightCollapsed) {
    return <div className="h-full min-h-0 w-full min-w-0">{left}</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0" onMouseMove={onMove} onMouseUp={stopDrag} onMouseLeave={stopDrag}>
      <div className="h-full min-h-0 min-w-0 pr-1" style={leftStyle}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        className="group flex h-full w-3 cursor-col-resize select-none items-center justify-center"
        onMouseDown={startDrag}
      >
        <span
          className={`h-12 w-[3px] rounded-full transition-colors ${
            dragging ? 'bg-[#8aa7dc]' : 'bg-[#c6d6f2] group-hover:bg-[#9bb7e5]'
          }`}
        />
      </div>
      <div className="h-full min-h-0 min-w-0 pl-1" style={rightStyle}>
        {right}
      </div>
    </div>
  );
};
