import React from "react";
import { CustomLink } from "../CustomLink/CustomLink";
import type { Navbar } from "../Navbar/Navbar";
import styles from "./SiteMenuTable.module.css";

export type NavigationItems = Awaited<
  ReturnType<typeof Navbar.getStaticProps>
>["data"]["result"]["settings"]["main_navigation"];

/**
 * The site's main menu as a table of links: one column per menu group, with the group's title on
 * top. For pages without the top menu, such as the 404 page and the gift card recipient page.
 */
export const SiteMenuTable: React.FC<{ navigationItems: NavigationItems }> = ({
  navigationItems,
}) => {
  const columns = navigationItems.map((item) =>
    item._type === "navgroup"
      ? [
          { title: item.title },
          ...(item.items ?? []).map((subItem) => ({
            title: subItem.title,
            slug: subItem.slug || "",
            type: subItem._type,
          })),
        ]
      : [
          null,
          {
            title: item.title,
            slug: item.slug || "",
            type: item._type,
          },
        ],
  );

  return (
    <div className={styles.table}>
      {columns.map((column, columnIndex) => (
        <div key={columnIndex} className={styles.column}>
          {column.map((item, rowIndex) => {
            if (!item) {
              return (
                <div key={`${columnIndex}-${rowIndex}`} className={styles.cell}>
                  &nbsp;
                </div>
              );
            }
            if ("slug" in item) {
              return (
                <div key={`${columnIndex}-${rowIndex}`} className={styles.cell}>
                  <CustomLink href={item.slug} type={item.type}>
                    {item.title}
                  </CustomLink>
                </div>
              );
            }
            return (
              <div key={`${columnIndex}-${rowIndex}`} className={styles.cell}>
                <span>{item.title}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};
