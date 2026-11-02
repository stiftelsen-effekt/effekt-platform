/**
 * Per-browser sidebar state: which items the user pinned to the top and which groups are
 * open. Pure helpers plus two persistent stores, so the sidebar itself stays dumb.
 */
import { createPersistentStore } from "@/lib/persistent-store";
import type { NavGroup, NavItem } from "./nav";

/** Groups open the first time someone uses the admin; the rest start collapsed. */
export const defaultOpenGroups = ["Donors", "Money in", "Agreements"];

export const pinnedStore = createPersistentStore<string[]>("nav-pinned", []);
export const openGroupsStore = createPersistentStore<string[]>(
  "nav-open-groups",
  defaultOpenGroups,
);

export function togglePinned(to: string) {
  pinnedStore.set((pins) => (pins.includes(to) ? pins.filter((pin) => pin !== to) : [...pins, to]));
}

export function setGroupOpen(label: string, open: boolean) {
  openGroupsStore.set((groups) => {
    const without = groups.filter((group) => group !== label);
    return open ? [...without, label] : without;
  });
}

/**
 * Moves pinned items out of their groups into one list, in pin order. Pins that point at
 * items that no longer exist (or are behind a feature flag) are ignored; groups left
 * empty disappear.
 */
export function splitPinned(
  groups: NavGroup[],
  pins: string[],
): { pinned: NavItem[]; groups: NavGroup[] } {
  const byTo = new Map(groups.flatMap((group) => group.items).map((item) => [item.to, item]));
  const pinned = pins.flatMap((to) => byTo.get(to) ?? []);
  const pinnedTo = new Set(pinned.map((item) => item.to));
  const rest = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !pinnedTo.has(item.to)) }))
    .filter((group) => group.items.length > 0);
  return { pinned, groups: rest };
}

/** The group whose item is the best (longest) match for the current path. */
export function activeGroupLabel(groups: NavGroup[], pathname: string): string | undefined {
  let best: { label?: string; length: number } | undefined;
  for (const group of groups) {
    for (const item of group.items) {
      const matches = item.exact
        ? pathname === item.to
        : item.to === "/"
          ? pathname === "/"
          : pathname === item.to || pathname.startsWith(`${item.to}/`);
      if (matches && (!best || item.to.length > best.length)) {
        best = { label: group.label, length: item.to.length };
      }
    }
  }
  return best?.label;
}
