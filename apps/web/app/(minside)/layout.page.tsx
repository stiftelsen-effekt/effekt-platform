import type { ReactNode } from "react";
import "../../styles/globals.css";

// Root layout of the App Router part of the site (Min Side). The content site stays on the pages
// router (pages/, with its own _document); the two share the global styles and SCSS modules.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={process.env.NEXT_PUBLIC_LANG || "no"}>
      <body>{children}</body>
    </html>
  );
}
