import { createElement, HTMLAttributes } from "react";
import { headingTag } from "./headingLevel";

/** A block title as a paragraph, h2 or h3, from the editor's heading_level */
export const BlockTitle: React.FC<
  HTMLAttributes<HTMLElement> & { level?: string; "data-toc-key"?: string }
> = ({ level, ...props }) => createElement(headingTag(level), props);
