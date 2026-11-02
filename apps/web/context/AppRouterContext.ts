import { createContext, useContext } from "react";

/**
 * True inside the App Router (Min Side, app/), false on the pages router. Shared components that
 * behave differently per router (links, the navbar) read it. `next/compat/router` can't tell: it
 * gives a router during the App Router's server render but null in the browser, which breaks
 * hydration.
 */
export const AppRouterContext = createContext(false);

export const useIsAppRouter = () => useContext(AppRouterContext);
