import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

const debounce = (fn: () => void, delay: number) => {
  let timeoutId: NodeJS.Timeout;

  const debounced = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(fn, delay);
  };
  debounced.cancel = () => clearTimeout(timeoutId);

  return debounced;
};

/**
 * What the server renders (and hydration assumes) before the window's width is known: mobile by
 * default. Min Side's server-rendered pages (App Router) provide the user agent's guess instead,
 * so a page starts in the right layout.
 */
export const MobileGuessContext = createContext(true);

const getSnapshot = () => window.innerWidth < 1180;

export const useIsMobile = (delay = 250) => {
  const serverGuess = useContext(MobileGuessContext);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const handleResize = debounce(onChange, delay);

      window.addEventListener("resize", handleResize);
      return () => {
        handleResize.cancel();
        window.removeEventListener("resize", handleResize);
      };
    },
    [delay],
  );
  const getServerSnapshot = useCallback(() => serverGuess, [serverGuess]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};
