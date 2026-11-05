import { HEADING_LEVELS, HeadingLevel } from "../../../../studio/headingLevels";

/**
 * The element to render a block title with. Anything not set or not in the list is a paragraph,
 * which is how every title rendered before editors could choose.
 */
export const headingTag = (level: string | null | undefined): HeadingLevel =>
  HEADING_LEVELS.find((option) => option.value === level)?.value ?? "p";
