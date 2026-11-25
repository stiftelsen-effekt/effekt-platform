import { Gift } from "react-feather";
import { defineField, defineType } from "sanity";

/** Buying a gift card: the product's pictures and the purchase steps (GiftcardBlock) */
export default defineType({
  name: "giftcardwidget",
  type: "object",
  title: "Gift card purchase",
  icon: Gift,
  fields: [
    defineField({
      name: "product",
      type: "reference",
      title: "Gift card product",
      to: [{ type: "giftcardproduct" }],
      validation: (Rule) => Rule.required(),
    }),
  ],
  preview: {
    select: { title: "product.title", media: "product.images.0" },
    prepare: ({ title, media }) => ({
      title: title ?? "Gift card purchase",
      subtitle: "Gift card purchase",
      media,
    }),
  },
});
