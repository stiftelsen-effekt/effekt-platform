"use client";

import "react-toastify/dist/ReactToastify.css";
import { ToastContainer } from "react-toastify";
import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { AppRouterContext } from "../../../context/AppRouterContext";
import { MainLocaleContext, type MainLocale } from "../../../context/MainLocaleContext";
import { RouterContext, type RouterContextValue } from "../../../context/RouterContext";
import { NavbarAuthContext } from "../../shared/components/Navbar/NavbarAuthContext";
import { WidgetContext, type WidgetContextType } from "../../main/layout/layout";
import { TrpcClientContext } from "../../../lib/trpc/useTrpcClient";
import { createServerActionTrpcClient } from "../../../lib/trpc/serverActionLink";
import { minsideMutation } from "../../../app/(minside)/minside-app/actions";

/**
 * The React contexts the existing Min Side components read, for the App Router's Min Side layout.
 * Only public Sanity data comes in here; nothing about the donor (the layout doesn't read the
 * session, see lib/minside/dal.ts).
 */
export function MinsideAppProviders({
  loggedIn,
  mainLocale,
  routerContext,
  children,
}: {
  /** The navbar's logged-in buttons (false on Min Side's public pages) */
  loggedIn: boolean;
  mainLocale: MainLocale;
  routerContext: RouterContextValue;
  children: ReactNode;
}) {
  // Logging out goes through the server: /auth/logout clears the cookie and ends the Auth0 session.
  const navbarAuth = useMemo(
    () => ({ loggedIn, logout: () => window.location.assign("/auth/logout") }),
    [loggedIn],
  );
  // Mutations go to a Server Action; queries are rendered on the server
  const trpc = useMemo(() => createServerActionTrpcClient(minsideMutation), []);
  const [widget, setWidget] = useState<WidgetContextType>({
    open: false,
    prefilled: null,
    prefilledSum: null,
    prefilledRecurring: null,
  });
  const widgetContext = useMemo<[WidgetContextType, Dispatch<SetStateAction<WidgetContextType>>]>(
    () => [widget, setWidget],
    [widget],
  );

  return (
    <AppRouterContext.Provider value={true}>
      <MainLocaleContext.Provider value={mainLocale}>
        <RouterContext.Provider value={routerContext}>
          <NavbarAuthContext.Provider value={navbarAuth}>
            <TrpcClientContext.Provider value={trpc}>
              <WidgetContext.Provider value={widgetContext}>
                <ToastContainer position="top-right" />
                {children}
              </WidgetContext.Provider>
            </TrpcClientContext.Provider>
          </NavbarAuthContext.Provider>
        </RouterContext.Provider>
      </MainLocaleContext.Provider>
    </AppRouterContext.Provider>
  );
}
