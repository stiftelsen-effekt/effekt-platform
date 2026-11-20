/**
 * Builds the text shown next to one gift on a fundraiser page's donor wall, from the matching
 * Sanity template. The recurring templates are optional: a fundraiser page that hasn't set them
 * yet falls back to the ordinary (one-off) template for a recurring gift too.
 */
export function giftAmountText(
  templates: {
    gift_amount_text_template: string;
    anonymous_gift_amount_text_template: string;
    recurring_gift_amount_text_template?: string | null;
    anonymous_recurring_gift_amount_text_template?: string | null;
  },
  name: string | null,
  formattedSum: string,
  recurring?: boolean,
): string {
  const template =
    (recurring &&
      (name
        ? templates.recurring_gift_amount_text_template
        : templates.anonymous_recurring_gift_amount_text_template)) ||
    (name ? templates.gift_amount_text_template : templates.anonymous_gift_amount_text_template);

  return template.replace("{name}", name ?? "Donor").replace("{sum}", formattedSum);
}
