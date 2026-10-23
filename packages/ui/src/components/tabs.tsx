import { Tabs as T } from 'radix-ui';
import type { ReactNode } from 'react';

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
