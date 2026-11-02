import { createContext, useContext } from "react";
import type { RouterContextValue } from "./fetchRouterContext";

export type { RouterContextValue } from "./fetchRouterContext";
export { fetchRouterContext } from "./fetchRouterContext";

export const RouterContext = createContext<RouterContextValue | null>(null);

export const useRouterContext = () => {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error("RouterContext not found. Did you forget to get app static props?");
  }
  return context;
};
