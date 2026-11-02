import type { ReactNode } from "react";
import { MinsideFrame } from "../../../../components/profile/app/MinsideFrame";

/** Min Side's pages that need no login (the anonymous Vipps agreement page) */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <MinsideFrame loggedIn={false}>{children}</MinsideFrame>;
}
