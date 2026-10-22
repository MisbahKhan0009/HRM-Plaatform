import { DropdownMenu as M, Tabs as T, Tooltip as TT } from 'radix-ui';
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

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TT.Root delayDuration={300}>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content
          sideOffset={6}
          className="z-50 rounded-control border border-line-strong bg-surface px-2 py-1 text-sm text-text"
        >
          {content}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}

export const TooltipProvider = TT.Provider;

/** Tabs (record pages): mono labels, accent underline for the active tab. */
export function Tabs({
  value,
  onValueChange,
  tabs,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  tabs: { value: string; label: ReactNode }[];
  children: ReactNode;
}) {
  return (
    <T.Root value={value} onValueChange={onValueChange} className="flex flex-col gap-6">
      <T.List className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections">
        {tabs.map((t) => (
          <T.Trigger
            key={t.value}
            value={t.value}
            className="-mb-px h-10 shrink-0 cursor-pointer border-b-2 border-transparent px-3 text-[15px] text-text-2 hover:text-text data-[state=active]:border-accent data-[state=active]:text-text"
          >
            {t.label}
          </T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  );
}

export const TabPanel = T.Content;
