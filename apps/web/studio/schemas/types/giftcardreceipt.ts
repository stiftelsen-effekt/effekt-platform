import { Gift } from "react-feather";
import { defineField, defineType } from "sanity";

/**
 * What the buyer just bought (number, recipient, when the SMS goes, the certificate link), for the
 * gift card thank-you page. Shows nothing unless this browser made the purchase in the ?kid= of
 * the URL (the purchase block keeps a token for it). The rest of the page is ordinary blocks.
 */
export default defineType({
  name: "giftcardreceipt",
  type: "object",
  title: "Gift card purchase details",
  icon: Gift,
  fields: [
    defineField({
      name: "show_certificate_link",
      type: "boolean",
      title: "Show the certificate download link",
      initialValue: true,
    }),
  ],
  preview: {
    prepare: () => ({ title: "Gift card purchase details" }),
  },
});
