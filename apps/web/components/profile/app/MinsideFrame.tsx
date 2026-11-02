import type { ReactNode } from "react";
import styles from "../../shared/layout/Layout/Layout.module.scss";
import { getMinsideFrame } from "../../../lib/minside/content";
import { MinsideAppProviders } from "./MinsideAppProviders";
import { Footer, MainHeader, Navbar } from "./client";

/**
 * Min Side's frame on the App Router: header, navigation and footer, kept across Min Side
 * navigations. Only Sanity content (cached), so it is part of the static shell. It doesn't read
 * the session (a layout isn't re-rendered on navigation): the pages check it (lib/minside/dal.ts),
 * and the proxy before anything renders. `loggedIn` only picks the navbar's buttons.
 */
export async function MinsideFrame({
  loggedIn,
  header,
  children,
}: {
  loggedIn: boolean;
  header?: ReactNode;
  children: ReactNode;
}) {
  const { navbar, footer, mainLocale, routerContext } = await getMinsideFrame();

  return (
    <MinsideAppProviders loggedIn={loggedIn} mainLocale={mainLocale} routerContext={routerContext}>
      {/* Dark theme: the old .dark variables for components not yet on the design system, and the
          design system's own (data-theme) */}
      <div className={`${styles.container} ${styles.dark}`}>
        {/* The header goes inside <main>, as on the pages router: .main sets the text colour */}
        <main className={styles.main} style={{ minHeight: "100vh" }}>
          <MainHeader hideOnScroll={false}>
            <Navbar {...navbar} />
            {header}
          </MainHeader>
          {children}
        </main>
        <Footer {...footer} />
      </div>
    </MinsideAppProviders>
  );
}
