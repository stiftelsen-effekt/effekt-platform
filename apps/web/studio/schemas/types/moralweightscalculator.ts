import { BarChart2 } from "react-feather";
import { defineType, defineField } from "sanity";

/**
 * A small calculator: a few outcomes (the first one is the benchmark), each with a number of people
 * helped for the same money and a moral weight. Readers move the weights and see which outcome
 * gives the most value. The numbers and the wording are all editable here, so the figures can be
 * kept in line with the source (GiveWell's moral weights page).
 */
export default defineType({
  name: "moralweightscalculator",
  type: "object",
  title: "Moral weights calculator",
  icon: BarChart2,
  fields: [
    defineField({ name: "title", type: "string", title: "Title" }),
    defineField({
      name: "description",
      type: "text",
      rows: 3,
      title: "Description",
      description:
        "Short instructions above the sliders. Sources go in a paragraph next to the block.",
    }),
    defineField({
      name: "outcomes",
      type: "array",
      title: "Outcomes",
      description:
        "The first outcome is the benchmark: its weight is fixed and the others are compared with it.",
      validation: (Rule) => Rule.required().min(2).max(4),
      of: [
        {
          type: "object",
          name: "moralweightoutcome",
          title: "Outcome",
          fields: [
            defineField({
              name: "label",
              type: "string",
              title: "Label",
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: "detail",
              type: "string",
              title: "Detail",
              description: "What the number of people means, e.g. 'one year each'",
            }),
            defineField({
              name: "count",
              type: "number",
              title: "People (or cases) for the same money",
              validation: (Rule) => Rule.required().min(0),
            }),
            defineField({
              name: "weight",
              type: "number",
              title: "Weight",
              description: "Units of value per person. For the benchmark: 1.",
              validation: (Rule) => Rule.required().min(0),
            }),
            defineField({
              name: "count_label",
              type: "string",
              title: "What the count counts",
              description: "Used for screen readers, e.g. 'barn' or 'personer'",
            }),
            defineField({
              name: "fixed",
              type: "boolean",
              title: "Fixed weight (benchmark)",
              description: "No slider for this outcome",
            }),
            defineField({
              name: "weight_label",
              type: "string",
              title: "Slider label",
              hidden: ({ parent }: { parent?: { fixed?: boolean } }) => !!parent?.fixed,
            }),
            defineField({
              name: "weight_unit",
              type: "string",
              title: "Slider unit",
              description: "Shown next to the slider value, e.g. 'personer'",
              hidden: ({ parent }: { parent?: { fixed?: boolean } }) => !!parent?.fixed,
            }),
            defineField({
              name: "weight_max",
              type: "number",
              title: "Slider maximum",
              initialValue: 300,
              hidden: ({ parent }: { parent?: { fixed?: boolean } }) => !!parent?.fixed,
            }),
          ],
          preview: { select: { title: "label", subtitle: "detail" } },
        },
      ],
    }),
    defineField({
      name: "presets",
      type: "array",
      title: "Presets",
      description:
        "Buttons that set all weights at once. One weight per outcome, in the same order.",
      of: [
        {
          type: "object",
          name: "moralweightpreset",
          title: "Preset",
          fields: [
            defineField({
              name: "label",
              type: "string",
              title: "Label",
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: "weights",
              type: "array",
              title: "Weights",
              of: [{ type: "number" }],
              validation: (Rule) =>
                Rule.required().custom((weights, context) => {
                  const outcomes = (context.document as any)?.outcomes;
                  return !outcomes || !Array.isArray(weights) || weights.length === outcomes.length
                    ? true
                    : "Give one weight per outcome";
                }),
            }),
          ],
          preview: { select: { title: "label" } },
        },
      ],
    }),
    defineField({
      name: "presets_label",
      type: "string",
      title: "Presets label",
      initialValue: "Velg utgangspunkt",
    }),
    defineField({
      name: "unit_label",
      type: "string",
      title: "Unit",
      initialValue: "enheter av verdi",
    }),
    defineField({
      name: "multiple_template",
      type: "string",
      title: "Multiple text",
      description: "Placeholders: {value}, {benchmark}",
      initialValue: "{value} × {benchmark}",
    }),
    defineField({
      name: "equivalent_template",
      type: "string",
      title: "Equivalent text",
      description:
        "Shown under each option except the first: what it is worth in benchmark people. Placeholder: {value}",
    }),
    defineField({
      name: "winner_template",
      type: "string",
      title: "Winner text",
      description: "Placeholder: {label}",
      initialValue: "Mest verdi i dette eksempelet: {label}.",
    }),
    defineField({
      name: "tie_template",
      type: "string",
      title: "Too close to call text",
      description: "Placeholder: {labels}",
      initialValue: "Omtrent like mye verdi: {labels}.",
    }),
    defineField({
      name: "breakeven_template",
      type: "string",
      title: "Break-even text",
      description: "Placeholders: {benchmark}, {label}, {value}",
      initialValue:
        "{benchmark} gir mer verdi enn «{label}» hvis hver person er verdt under {value}.",
    }),
    defineField({
      name: "number_locale",
      type: "string",
      title: "Number format",
      description: "BCP 47 locale for numbers, e.g. nb-NO, sv-SE or da-DK",
      initialValue: "nb-NO",
    }),
  ],
  preview: {
    select: { title: "title" },
    prepare: ({ title }: { title?: string }) => ({
      title: title || "Moral weights calculator",
      subtitle: "Calculator",
    }),
  },
});
