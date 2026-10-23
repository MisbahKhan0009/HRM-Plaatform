/** Up to two initials for the avatar button. */
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export const USER_MENU_TRIGGER =
  'grid size-9 cursor-pointer place-items-center rounded-full border border-line-strong bg-ground-2 font-mono text-sm font-medium';
