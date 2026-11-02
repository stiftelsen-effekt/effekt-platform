import Link from "next/link";
import styles from "./Footer.module.scss";
import { NewsletterSignup } from "../../../main/blocks/NewsletterSignup/NewsletterSignup";
import { withStaticProps } from "../../../../util/withStaticProps";
import { getFooterStaticProps } from "./footerStaticProps";

export type { FooterItem, FooterProps } from "./footerStaticProps";

const Footer = withStaticProps(getFooterStaticProps)(({ data }) => {
  const {
    footer_columns,
    footer_to_top_label,
    footer_newsletter_heading,
    footer_newsletter_form_url,
    footer_newsletter_send_label,
    footer_email_label,
    main_locale,
  } = data.result;

  const columnCount = footer_columns ? footer_columns.filter((c) => c.links).length : 0;

  const gridClass = styles[`grid_${columnCount}`];

  return (
    <footer className={`${styles.grid} ${gridClass}`} id={"footer"}>
      <div className={`${styles.category} ${styles.logo__bottom}`}>
        <figure>
          <p>G</p>
        </figure>
      </div>
      {footer_columns &&
        footer_columns.map((column, index) => (
          <div className={`${styles.category}`} key={column._key}>
            <ul>
              {column.links &&
                column.links.map((footerItem) => {
                  return (
                    <li key={footerItem._key}>
                      <Link
                        href={
                          footerItem._type === "navitem"
                            ? `/${footerItem.slug}`
                            : footerItem.url || "/"
                        }
                        target={footerItem._type === "link" && footerItem.newtab ? "_blank" : ""}
                      >
                        {footerItem.title}
                      </Link>
                    </li>
                  );
                })}
              {index === columnCount - 1 && (
                <>
                  <li>&nbsp;</li>
                  <li>
                    <a data-cy="navigate-to-top" href="#top">
                      {footer_to_top_label} &uarr;
                    </a>
                  </li>
                </>
              )}
            </ul>
          </div>
        ))}
      <div className={styles.newsletter}>
        <NewsletterSignup
          header={footer_newsletter_heading}
          formurl={footer_newsletter_form_url}
          sendlabel={footer_newsletter_send_label}
          emailLabel={footer_email_label}
          locale={main_locale}
        ></NewsletterSignup>
      </div>
      <div className={`${styles.category} ${styles.sanity}`}>
        Structured content powered by{" "}
        <a href="https://www.sanity.io/" target="_blank" rel="noreferrer">
          Sanity.io
        </a>
      </div>
    </footer>
  );
});

export default Footer;
