import { CheckOutlined, DownOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CompactDropdown } from './CompactDropdown';

export interface CompactSelectOption {
  label: string;
  value: string;
  /** Extra description shown as secondary text */
  description?: string;
  icon?: ReactNode;
}

export interface CompactSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  options: CompactSelectOption[];
  /** Optional non-selectable header shown at the top of the menu */
  menuHeader?: string;
  /** Placeholder when no value selected */
  placeholder?: string;
  className?: string;
  /** Min width of the dropdown popup */
  popupMinWidth?: number;
  disabled?: boolean;
}

export const CompactSelect = ({
  value,
  onChange,
  options,
  menuHeader,
  placeholder = '请选择',
  className = '',
  popupMinWidth = 160,
  disabled = false,
}: CompactSelectProps) => {
  const [open, setOpen] = useState(false);
  const [optimisticValue, setOptimisticValue] = useState<string | undefined>(value);
  const optionsSignature = useMemo(
    () => options.map((option) => option.value).join('||'),
    [options],
  );

  useEffect(() => {
    setOptimisticValue(value);
  }, [value, optionsSignature]);

  const resolvedValue = optimisticValue;
  const selectedOption = options.find((o) => o.value === resolvedValue);
  const dropdownInstanceKey = `${resolvedValue ?? '__empty__'}::${optionsSignature}`;
  const menuItems = [
    ...(menuHeader
      ? [
          {
            key: '__compact-select-header__',
            disabled: true,
            className: 'compact-select-menu-header-item',
            label: <span className="compact-select-menu-header-text">{menuHeader}</span>,
          },
        ]
      : []),
    ...options.map((opt) => ({
      key: opt.value,
      label: (
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            {opt.icon && <span className="text-xs text-slate-400">{opt.icon}</span>}
            <span className="truncate">{opt.label}</span>
            {opt.description && (
              <span className="shrink-0 text-[11px] text-slate-400">{opt.description}</span>
            )}
          </div>
          {opt.value === resolvedValue && (
            <CheckOutlined className="shrink-0 text-[11px] text-[#2f6ff7]" />
          )}
        </div>
      ),
    })),
  ];

  return (
    <CompactDropdown
      key={dropdownInstanceKey}
      destroyOnHidden
      open={disabled ? false : open}
      onOpenChange={(nextOpen) => {
        if (disabled) return;
        setOpen(nextOpen);
      }}
      trigger={['click']}
      overlayStyle={{ minWidth: popupMinWidth }}
      menu={{
        selectable: true,
        selectedKeys: resolvedValue ? [resolvedValue] : [],
        items: menuItems,
        onClick: (info) => {
          if (disabled) return;
          if (info.key === '__compact-select-header__') return;
          const nextValue = String(info.key);
          setOptimisticValue(nextValue);
          setOpen(false);
          onChange?.(nextValue);
        },
      }}
    >
      <button
        type="button"
        disabled={disabled}
        className={`compact-select-trigger no-drag inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] leading-normal text-slate-500 transition-colors ${
          disabled
            ? "cursor-default opacity-75"
            : "hover:bg-slate-100 hover:text-slate-700"
        } ${className}`}
      >
        <span className="max-w-[200px] truncate">
          {selectedOption?.label ?? resolvedValue ?? placeholder}
        </span>
        <DownOutlined className={`text-[9px] ${disabled ? "opacity-40" : ""}`} />
      </button>
    </CompactDropdown>
  );
};
