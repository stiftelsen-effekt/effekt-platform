import React from "react";

export type GiftIconName = "child" | "net" | "vaccine" | "capsule" | "coin" | "heart";

/** Simple line icons for the impact counter, drawn in currentColor */
export const GiftIcon: React.FC<{ name: GiftIconName }> = ({ name }) => (
  <svg
    viewBox="0 0 24 24"
    width="100%"
    height="100%"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {ICONS[name] ?? ICONS.heart}
  </svg>
);

const ICONS: Record<GiftIconName, React.ReactNode> = {
  child: (
    <>
      <circle cx="12" cy="5" r="2.6" />
      <path d="M12 9.5v5.5" />
      <path d="M7.5 12.5 12 10l4.5 2.5" />
      <path d="M9.5 21 12 15l2.5 6" />
    </>
  ),
  net: (
    <>
      <path d="M4 20V9c0-3 3.6-6 8-6s8 3 8 6v11" />
      <path d="M4 12h16M4 16h16M8 4.5V20M12 3v17M16 4.5V20" />
    </>
  ),
  vaccine: (
    <>
      <path d="m17 3 4 4M19 5l-9.5 9.5M14 6l4 4" />
      <path d="M12.5 7.5 5 15l-1 5 5-1 7.5-7.5" />
      <path d="m7.5 12.5 2 2M10 10l2 2" />
    </>
  ),
  capsule: (
    <>
      <rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)" />
      <path d="m9.3 8.2 4 5.7" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.6 0-2.7.8-2.7 2s1.1 1.7 2.7 2 2.7.8 2.7 2-1.1 2-2.7 2c-1.1 0-2-.4-2.5-1.2M12 6.5v11" />
    </>
  ),
  heart: (
    <path d="M12 20s-7.5-4.4-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.6-7.5 10-7.5 10Z" />
  ),
};
