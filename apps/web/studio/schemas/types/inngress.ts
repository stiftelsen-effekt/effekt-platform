import { Type } from "react-feather";
import { defineType, defineField } from "sanity";
import { HEADING_LEVELS } from "../../headingLevels";

export default defineType({
  name: "inngress",
  type: "object",
  title: "Inngress",
  icon: Type,
  fields: [
    defineField({
      name: "heading",
      type: "string",
      title: "Heading",
    }),
    defineField({
      name: "heading_level",
      title: "Heading level",
      type: "string",
      options: { list: [...HEADING_LEVELS], layout: "radio", direction: "horizontal" },
      description:
        "Looks the same either way. Choose a heading to put it in the page outline for search engines and screen readers: h2 for a main section, h3 under it.",
    }),
    defineField({
      name: "body",
      type: "array",
      of: [{ type: "block" }],
      title: "body",
    }),
    defineField({
      name: "sidelinks",
      type: "array",
      of: [{ type: "link" }, { type: "navitem" }],
      title: "Sidelinks",
    }),
  ],
  preview: {
    select: {
      title: "heading",
      subtitle: "body",
    },
  },
});
