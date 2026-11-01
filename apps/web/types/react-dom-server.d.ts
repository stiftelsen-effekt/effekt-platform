// The web app has no @types/react-dom; the unit tests that render components on the server
// (renderToStaticMarkup, no DOM) only need this
declare module "react-dom/server" {
  import type { ReactNode } from "react";
  export function renderToStaticMarkup(element: ReactNode): string;
}
