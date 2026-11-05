import styles from "./Inngress.module.scss";

import { NavLink } from "../../../shared/components/Navbar/Navbar";
import { LinkType, Links } from "../Links/Links";
import { PortableText } from "@portabletext/react";
import { BlockTitle } from "../Paragraph/BlockTitle";

export const Inngress: React.FC<{
  header: string;
  /** h2 or h3 to put the heading in the page outline; a paragraph when not set */
  headerLevel?: string;
  content: any[];
  links: (LinkType | NavLink)[];
}> = ({ header, headerLevel, content, links }) => {
  return (
    <div className={styles.ingress__container}>
      <div className={styles.links}>
        <Links links={links} />
      </div>
      <div className={styles.intro}>
        <BlockTitle level={headerLevel} className="inngress">
          {header}
        </BlockTitle>
        <div className={styles.maincontent}>
          <PortableText value={content}></PortableText>
        </div>
      </div>
    </div>
  );
};
