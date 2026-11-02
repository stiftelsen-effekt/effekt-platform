import React, { Suspense, useCallback, useContext, useEffect, useState } from "react";
import styles from "./Navbar.module.scss";
import { useRouter } from "next/compat/router";
import { useIsAppRouter } from "../../../../context/AppRouterContext";
import { usePathname } from "next/navigation";
import AnimateHeight from "react-animate-height";
import { WidgetContext } from "../../../main/layout/layout";
import { EffektButton, EffektButtonVariant } from "../EffektButton/EffektButton";
import { preloadDonationWidgetProps } from "../../../main/layout/WidgetPane/loadWidget";
import { ResponsiveImage } from "../../responsiveimage";
import { useRouterContext } from "../../../../context/RouterContext";
import { withStaticProps } from "../../../../util/withStaticProps";
import { NavbarAuthContext } from "./NavbarAuthContext";
import { stegaClean } from "@sanity/client/stega";
import { CustomLink } from "../CustomLink/CustomLink";
import { LiveQuery } from "../../LiveQuery";
import { getNavbarStaticProps } from "./navbarStaticProps";

/* .logoWrapper is 250px wide on large screens, .logoWrapperImage 160px below that */
const LOGO_SIZES = "(min-width: 1521px) 250px, 160px";

export type {
  NavLink,
  MainNavbarGroup,
  MainNavbarItem,
  NavBarQueryResult,
} from "./navbarStaticProps";

export const Navbar = withStaticProps(getNavbarStaticProps)(({
  data,
  dashboard,
  useDashboardLogo,
}) => {
  // Rendered by both routers. Under the App Router (Min Side), <OnAppRouterNavigation> below closes
  // the menu on navigation instead of the pages router's asPath.
  const router = useRouter();
  const appRouter = useIsAppRouter();
  const settingsData = data.result.settings;
  const dashboardData = data.result.dashboard;

  let filteredElements = dashboard
    ? data.result.dashboard.main_navigation
    : data.result.settings.main_navigation;
  filteredElements = filteredElements.filter((e) => e !== null);
  const logo = data.result.settings.logo;

  const dashboardLogo = data.result.dashboard.dashboard_logo;

  const showDashboardButton = !settingsData.hide_dashboard_button;

  const labels = {
    dashboard: dashboardData.dashboard_label,
    logout: dashboardData.logout_label,
  };

  const giveButton = {
    donate_label: settingsData.donate_label,
    accent_color: stegaClean(settingsData.accent_color),
  };

  const { dashboardPath } = useRouterContext();
  const [, setWidgetContext] = useContext(WidgetContext);
  const { loggedIn, logout } = useContext(NavbarAuthContext);

  const [expandMenu, setExpandMenu] = useState<boolean>(false);
  const [expandedSubmenu, setExpandedSubmenu] = useState<{ [key: string]: boolean }>(
    filteredElements.reduce((a, v) => ({ ...a, [v._key]: false }), {}),
  );

  const closeMenu = useCallback(() => {
    setExpandMenu(false);
    if (typeof document !== "undefined") {
      document.body.style.overflow = "auto";
    }
  }, []);
  useEffect(closeMenu, [router?.asPath, closeMenu]);

  const setExpanded = (expanded: boolean) => {
    if (expanded && window.innerWidth < 1180) document.body.style.overflow = "hidden";
    else if (typeof document !== "undefined") document.body.style.overflow = "auto";

    setExpandMenu(expanded);
  };

  const toggleExpanded = (key: string) => {
    if (expandMenu) {
      const expanded = { ...expandedSubmenu };
      expanded[key] = !expandedSubmenu[key];
      setExpandedSubmenu(expanded);
    }
  };

  let giveButtonStyle = {};
  if (giveButton.accent_color) {
    giveButtonStyle = {
      "--accent-color": giveButton.accent_color,
    } as React.CSSProperties;
  }

  const lightLogo =
    ((useDashboardLogo || dashboard) && !expandMenu) ||
    (!useDashboardLogo && !dashboard && expandMenu);

  return (
    <div
      className={`${styles.container} ${expandMenu ? styles.navbarExpanded : ""}`}
      data-mobile-menu-expanded={expandMenu ? "true" : "false"}
    >
      <nav className={`${styles.navbar}`} data-cy="navbar">
        {appRouter && (
          <Suspense fallback={null}>
            <OnAppRouterNavigation onNavigate={closeMenu} />
          </Suspense>
        )}
        <div
          className={styles.logoWrapper}
          onMouseDown={(e) => (e.currentTarget.style.outline = "none")}
          onMouseUp={(e) => e.currentTarget.removeAttribute("style")}
        >
          {lightLogo && (
            <div className={styles.logoWrapperImage}>
              <CustomLink
                href="/"
                onClick={(e) => e.currentTarget.blur()}
                style={{
                  position: "relative",
                  height: "100%",
                  width: "100%",
                  display: "inline-block",
                }}
              >
                <ResponsiveImage
                  image={dashboardLogo}
                  onClick={() => setExpanded(false)}
                  sizes={LOGO_SIZES}
                  priority
                />
              </CustomLink>
            </div>
          )}
          {!lightLogo && (
            <div className={styles.logoWrapperImage}>
              <CustomLink
                href="/"
                onClick={(e) => e.currentTarget.blur()}
                style={{
                  position: "relative",
                  height: "100%",
                  width: "100%",
                  display: "inline-block",
                }}
              >
                <ResponsiveImage
                  image={logo}
                  onClick={() => setExpanded(false)}
                  sizes={LOGO_SIZES}
                  priority
                />
              </CustomLink>
            </div>
          )}
          <button
            className={styles.expandBtn}
            onClick={(e) => {
              setExpanded(!expandMenu);
              e.currentTarget.blur();
            }}
            aria-label={expandMenu ? "Open menu" : "Close menu"}
          >
            <AnimatedMenuIcon isOpen={expandMenu} />
          </button>
        </div>
        <ul>
          {filteredElements.map((el) =>
            el._type === "navgroup" ? (
              <li
                key={el._key}
                className={
                  expandedSubmenu[el._key] ? styles.expandedSubmenu : styles.collapsedSubmenu
                }
              >
                <button onClick={() => toggleExpanded(el._key)} tabIndex={-1}>
                  {el.title}
                </button>
                <AnimateHeight
                  height={expandedSubmenu[el._key] ? "auto" : 0}
                  animateOpacity
                  aria-hidden="false"
                >
                  <div className={styles.submenu}>
                    <ul>
                      {el.items &&
                        el.items
                          .filter((subel) => subel !== null)
                          .map((subel) => (
                            <li key={subel.title} data-cy={`${subel.slug}-link`.replace(/ /g, "-")}>
                              <CustomLink
                                // nosemgrep: typescript.react.security.audit.react-href-var.react-href-var -- navigation slugs from Sanity, edited only by staff
                                href={[...(dashboard ? dashboardPath : []), subel.slug].join("/")}
                                onClick={(e) => {
                                  e.currentTarget.blur();
                                  setExpanded(false);
                                }}
                              >
                                {subel.title}
                              </CustomLink>
                            </li>
                          ))}
                    </ul>
                  </div>
                </AnimateHeight>
              </li>
            ) : (
              <li key={el._key} data-cy={`${el.slug}-link`}>
                <CustomLink
                  // nosemgrep: typescript.react.security.audit.react-href-var.react-href-var -- navigation slugs from Sanity, edited only by staff
                  href={[...(dashboard ? dashboardPath : []), el.slug].join("/")}
                  onClick={() => setExpanded(false)}
                >
                  {el.title}
                </CustomLink>
              </li>
            ),
          )}
          <li className={styles.buttonsWrapper}>
            {loggedIn ? (
              <EffektButton
                variant={EffektButtonVariant.SECONDARY}
                onClick={logout}
                extraMargin={true}
              >
                {labels.logout}
              </EffektButton>
            ) : (
              showDashboardButton && (
                <CustomLink href={dashboardPath.join("/")} tabIndex={-1}>
                  <EffektButton
                    variant={EffektButtonVariant.SECONDARY}
                    onClick={() => setExpanded(false)}
                  >
                    {labels.dashboard}
                  </EffektButton>
                </CustomLink>
              )
            )}
            <EffektButton
              cy="send-donation-button"
              extraMargin={true}
              {...preloadDonationWidgetProps}
              onClick={() =>
                setWidgetContext({
                  open: true,
                  prefilled: null,
                  prefilledSum: null,
                  prefilledRecurring: null,
                })
              }
              variant={
                giveButton.accent_color && !loggedIn
                  ? EffektButtonVariant.ACCENT
                  : EffektButtonVariant.PRIMARY
              }
              style={giveButtonStyle}
            >
              {giveButton.donate_label}
            </EffektButton>
          </li>
        </ul>
      </nav>
    </div>
  );
});

const AnimatedMenuIcon = ({ isOpen }: { isOpen: boolean }) => {
  const lineStyles = {
    transition: "all 200ms ease",
    transformOrigin: "center",
  };

  const topLineStyles = {
    ...lineStyles,
    transform: isOpen ? "translateY(4px) translateX(-5px) rotate(45deg)" : "none",
  };

  const middleLineStyles = {
    ...lineStyles,
    opacity: isOpen ? 0 : 1,
  };

  const bottomLineStyles = {
    ...lineStyles,
    transform: isOpen ? "translateY(-4px) translateX(-5px) rotate(-45deg)" : "none",
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="6" x2="21" y2="6" style={topLineStyles} />
      <line x1="3" y1="12" x2="21" y2="12" style={middleLineStyles} />
      <line x1="3" y1="18" x2="21" y2="18" style={bottomLineStyles} />
    </svg>
  );
};

export const PreviewNavbar: React.FC<Awaited<ReturnType<typeof Navbar.getStaticProps>>> = (
  props,
) => {
  return (
    <LiveQuery data={props.data}>{(data) => <Navbar {...(props as any)} data={data} />}</LiveQuery>
  );
};

/**
 * Calls onNavigate when the App Router's path changes. Reading the path is request data, so it sits
 * in its own <Suspense> boundary and the navbar itself stays in the prerendered shell.
 */
function OnAppRouterNavigation({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  useEffect(onNavigate, [pathname, onNavigate]);
  return null;
}
