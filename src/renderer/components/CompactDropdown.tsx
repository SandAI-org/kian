import { Dropdown } from 'antd';
import type { DropdownProps } from 'antd';
import type { ReactNode } from 'react';

/** Shared CSS class names for consistent dropdown styling */
export const COMPACT_DROPDOWN_OVERLAY = 'compact-dropdown-overlay no-drag';
export const COMPACT_DROPDOWN_MENU = 'compact-dropdown-menu';

export interface CompactDropdownProps extends Omit<DropdownProps, 'overlayClassName'> {
  children: ReactNode;
}

/**
 * Standard dropdown wrapper that applies the shared compact style.
 *
 * Usage – action menu:
 * ```tsx
 * <CompactDropdown menu={{ items: [...], className: COMPACT_DROPDOWN_MENU }}>
 *   <Button type="text" icon={<EllipsisOutlined />} />
 * </CompactDropdown>
 * ```
 *
 * For selection dropdowns prefer the higher-level `<CompactSelect />`.
 */
export const CompactDropdown = ({ menu, children, ...rest }: CompactDropdownProps) => (
  <Dropdown
    overlayClassName={COMPACT_DROPDOWN_OVERLAY}
    menu={{
      ...menu,
      className: [COMPACT_DROPDOWN_MENU, menu?.className].filter(Boolean).join(' '),
    }}
    {...rest}
  >
    {children}
  </Dropdown>
);
