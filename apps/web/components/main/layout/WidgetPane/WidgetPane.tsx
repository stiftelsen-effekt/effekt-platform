import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import React, { ComponentProps, useContext, useEffect, useState } from "react";
import type { Widget as WidgetType } from "../../../shared/components/Widget/components/Widget";
import { WidgetContext } from "../layout";
import styles from "./WidgetPane.module.scss";
import { loadWidget } from "./loadWidget";

const Widget = dynamic<WidgetPaneProps>(loadWidget, {
  ssr: false,
});

export type PrefilledDistribution = {
  causeAreaId: number;
  share: number;
  organizations: { organizationId: number; share: number }[];
}[];

export interface WidgetPaneProps extends ComponentProps<typeof WidgetType> {
  darkMode?: boolean;
  prefilled: PrefilledDistribution | null;
  prefilledSum: number | null;
}

export const WidgetPane: React.FC<WidgetPaneProps> = ({ darkMode, ...widgetProps }) => {
  const [widgetContext] = useContext(WidgetContext);
  const { query } = useRouter();

  // The widget (its code, and its cause areas and referral types from the API) is only loaded
  // once the pane is first opened, and then kept for the rest of the visit. The pane is fixed
  // and hidden while closed, so this doesn't move the page. Links with ?distribution= or
  // ?recurring= open the pane from inside the widget (useQueryParamsPrefill), so those load it
  // right away.
  const opensFromQuery = query.distribution !== undefined || query.recurring !== undefined;
  const [widgetLoaded, setWidgetLoaded] = useState(false);
  if (!widgetLoaded && (widgetContext.open || opensFromQuery)) {
    setWidgetLoaded(true);
  }

  // On initial load, have no animation
  // Then reset on render
  // This is to prevent jancky initial page load where the pane flies over the screen
  const [paneStyle, setPaneStyle] = useState<any>({ transition: "none" });
  const [paneSlidIn, setPaneSlidIn] = useState(false);

  // Show the pane right away when opened, and slide it in once it is displayed.
  // When closed, slide it out right away, and hide it once it has slid out.
  useEffect(() => {
    if (widgetContext.open) {
      const timeoutId = setTimeout(() => {
        setPaneStyle({ display: "block" });
        setPaneSlidIn(true);
      }, 20);
      return () => clearTimeout(timeoutId);
    }
    const timeoutId = setTimeout(() => {
      setPaneStyle({ display: "none" });
      setPaneSlidIn(false);
    }, 200);
    return () => clearTimeout(timeoutId);
  }, [widgetContext.open]);

  const style = widgetContext.open ? { display: "block" } : paneStyle;
  const widgetOpenClass = widgetContext.open && paneSlidIn ? styles.widgetPaneOpen : "";

  const useDarkmode = darkMode || widgetProps.data.result.color_scheme === "light";

  return (
    <aside
      data-cy="widget-pane"
      className={`${styles.widgetPane} ${widgetOpenClass} ${useDarkmode ? styles.dark : ""}`}
      style={style}
    >
      <div className={styles.widgetPaneHeader}></div>
      <div className={styles.widgetPaneContent}>{widgetLoaded && <Widget {...widgetProps} />}</div>
    </aside>
  );
};
