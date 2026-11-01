/**
 * The donation widget's code, loaded the first time its pane opens (WidgetPane). Give buttons call
 * preloadDonationWidget on hover, focus and touch, so the code is usually there by the click.
 */
export const loadWidget = () =>
  import("../../../shared/components/Widget/components/Widget").then((mod) => mod.Widget);

export const preloadDonationWidget = () => {
  void loadWidget();
};

/** Props for a give button: start loading the widget when the donor is about to press it */
export const preloadDonationWidgetProps = {
  onPointerEnter: preloadDonationWidget,
  onFocus: preloadDonationWidget,
  onTouchStart: preloadDonationWidget,
} as const;
