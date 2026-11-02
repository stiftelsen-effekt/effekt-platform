import type { ReactNode } from "react";
import type { Metadata } from "next";
import { getMinsideFrame } from "../../../../lib/minside/content";
import { MinsideFrame } from "../../../../components/profile/app/MinsideFrame";

/**
 * Every logged-in page is a blocking route: rendered whole once the donor's data is there (no
 * loaders; see docs/minside-ssr-plan.md). Set here too, so navigations between the pages aren't
 * flagged in development either.
 */
export const instant = false;

/** The logged-in Min Side pages (the proxy sends visitors without a session to the login) */
export async function generateMetadata(): Promise<Metadata> {
  const { siteTitle } = await getMinsideFrame();
  return { title: siteTitle, icons: { icon: "/favicon.ico" } };
}

export default function AccountLayout({
  children,
  header,
}: {
  children: ReactNode;
  /** Page-specific additions to the header (@header), e.g. the donations' year menu on mobile */
  header: ReactNode;
}) {
  return (
    <MinsideFrame loggedIn header={header}>
      {children}
    </MinsideFrame>
  );
}
