import React, { useEffect } from "react";
import elements from "./Paragraph.module.scss";
import { PortableText } from "@portabletext/react";
import { customComponentRenderers, observeCitationLayout, reflowCitations } from "./Citation";
import { BlockTitle } from "./BlockTitle";

export type ParagraphProps = {
  tocKey: string;
  title: string;
  /** h2 or h3 to put the title in the page outline; a paragraph when not set */
  titleLevel?: string;
  blocks: any[];
};

export const Paragraph: React.FC<ParagraphProps> = ({ title, titleLevel, tocKey, blocks }) => {
  useEffect(observeCitationLayout, []);
  useEffect(() => {
    reflowCitations();
  }, [blocks]);

  return (
    <div className={elements.paragraphwrapper}>
      <BlockTitle level={titleLevel} className="inngress" data-toc-key={tocKey}>
        {title}
      </BlockTitle>
      <PortableText value={blocks || []} components={customComponentRenderers}></PortableText>
    </div>
  );
};
