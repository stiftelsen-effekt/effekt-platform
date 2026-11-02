import React, { type ReactNode } from "react";
import elements from "./PageContent.module.scss";

export const PageContent: React.FC<{
  children: ReactNode;
  title?: ReactNode;
  titleOnMobile?: boolean;
}> = ({ children, title, titleOnMobile }) => (
  <section className={elements.pageContent}>
    {title && <h1 className={titleOnMobile ? undefined : elements.title}>{title}</h1>}
    {children}
  </section>
);
