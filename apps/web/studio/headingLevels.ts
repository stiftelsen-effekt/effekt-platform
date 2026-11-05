/** The elements an editor can choose for a block title (field heading_level) */
export const HEADING_LEVELS = [
  { title: "Paragraph (as before)", value: "p" },
  { title: "Heading 2 (h2)", value: "h2" },
  { title: "Heading 3 (h3)", value: "h3" },
] as const;

export type HeadingLevel = (typeof HEADING_LEVELS)[number]["value"];
