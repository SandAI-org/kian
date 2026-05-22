import type { CSSProperties, ReactNode } from 'react';
import SimpleBar from 'simplebar-react';

interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  autoHide?: boolean;
  onScroll?: (event: Event) => void;
}

export const ScrollArea = ({
  children,
  className,
  style,
  autoHide = false,
  onScroll
}: ScrollAreaProps) => (
  <SimpleBar
    className={className}
    style={style}
    autoHide={autoHide}
    scrollableNodeProps={onScroll ? { onScroll } : undefined}
  >
    {children}
  </SimpleBar>
);
