import { DropdownMenu as M } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../cn';

const menuPanel = 'z-50 min-w-48 rounded-card border border-line-strong bg-surface p-1 text-text';
const menuItem =
  'flex h-9 cursor-pointer items-center gap-2 rounded-control px-3 text-[15px] outline-none select-none data-[highlighted]:bg-ground-2 data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-text-2';

export const MenuRoot = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ children, align = 'end' }: { children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <M.Portal>
      <M.Content align={align} sideOffset={6} className={menuPanel}>
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  destructive,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <M.Item
      className={cn(menuItem, destructive && 'text-bad [&_svg]:text-bad')}
      disabled={disabled ?? false}
      {...(onSelect ? { onSelect } : {})}
    >
      {children}
    </M.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-3 py-2 text-sm text-text-2">{children}</M.Label>;
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-line" />;
}
