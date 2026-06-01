import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
      if (!dragging || leftCollapsed || rightCollapsed) return;
      const parent = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
      const next = ((event.clientX - parent.left) / parent.width) * 100;
      const clamped = Math.max(50, Math.min(80, next));
      setLeftWidth(clamped);
      window.dispatchEvent(new Event('resize'));
    },
    [dragging, leftCollapsed, rightCollapsed, setLeftWidth]
  );

  const leftPaneWidth = leftCollapsed ? 0 : rightCollapsed ? 100 : leftWidth;
  const rightPaneWidth = rightCollapsed ? 0 : leftCollapsed ? 100 : 100 - leftWidth;
  const dividerVisible = !leftCollapsed && !rightCollapsed;
  const leftStyle = useMemo(() => ({ width: `${leftPaneWidth}%` }), [leftPaneWidth]);
  const rightStyle = useMemo(() => ({ width: `${rightPaneWidth}%` }), [rightPaneWidth]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [leftCollapsed, rightCollapsed]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0" onMouseMove={onMove} onMouseUp={stopDrag} onMouseLeave={stopDrag}>
      <div
        className={`h-full min-h-0 min-w-0 overflow-hidden ${
          leftCollapsed ? 'pointer-events-none' : dividerVisible ? 'pr-1' : ''
        }`}
        style={leftStyle}
        aria-hidden={leftCollapsed}
      >
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        className={`group h-full w-3 cursor-col-resize select-none items-center justify-center ${
          dividerVisible ? 'flex' : 'hidden'
        }`}
        onMouseDown={startDrag}
      >
        <span
          className={`h-12 w-[3px] rounded-full transition-colors ${
            dragging ? 'bg-[#8aa7dc]' : 'bg-[#c6d6f2] group-hover:bg-[#9bb7e5]'
          }`}
        />
      </div>
      <div
        className={`h-full min-h-0 min-w-0 overflow-hidden ${
          rightCollapsed ? 'pointer-events-none' : dividerVisible ? 'pl-1' : ''
        }`}
        style={rightStyle}
        aria-hidden={rightCollapsed}
      >
        {right}
      </div>
    </div>
  );
};
