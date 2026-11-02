"use client";

import { WidgetPane, type WidgetPaneProps } from "../../main/layout/WidgetPane/WidgetPane";
import { WidgetStoreProvider } from "../../shared/components/Widget/store/store";

export function MinsideWidgetPane(props: WidgetPaneProps) {
  return (
    <WidgetStoreProvider>
      <WidgetPane {...props} />
    </WidgetStoreProvider>
  );
}
