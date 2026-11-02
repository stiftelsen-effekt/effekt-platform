import { useOptionalMinsideSession } from "./context/MinsideSessionContext";
import { linksContentQuery, linksSelectorQuery } from "./lib/sanity/linkQueries";
import { widgetContentQuery } from "./components/shared/components/Widget/widgetStaticProps";

// Min Side's data is loaded on the server (lib/minside, app/(minside)) and handed to its client
// components through MinsideSessionContext; these hooks read it there. The rest of the file is
// the Sanity query fragments the pages router uses.

const fromPage = <T>(data: T | undefined) => ({
  data,
  loading: false,
  isValidating: false,
  error: data === undefined ? new Error("Not provided by the page") : undefined,
});

/** The reasons for stopping an agreement, as the Min Side page loaded them on the server */
export const useAgreementFeedbackTypes = () =>
  fromPage(useOptionalMinsideSession()?.agreementFeedbackTypes);

/** Every cause area with its organizations, as the Min Side page loaded them on the server */
export const useCauseAreas = () => fromPage(useOptionalMinsideSession()?.causeAreas);

/**
 * The donor's tax units, as the Min Side page rendered them on the server
 * (MinsidePageProviders → MinsideSessionContext.taxUnits)
 */
export const useMinsideTaxUnits = () => {
  const taxUnits = useOptionalMinsideSession()?.taxUnits;
  return { data: taxUnits, loading: false, isValidating: false, error: undefined };
};

export { linksContentQuery, linksSelectorQuery };

const cookieBannerQueryString = `
  ...,
  privacy_policy_link {
    "_key": coalesce(_id,_key,"id_privacy_policy_link"),
    _type,
    title,
    "slug": page->slug.current,
    "pagetype": coalesce(page->_type, "generic_page"),
  }
`;

const generalBannerQueryString = `
  ...,
  link {
    "_key": coalesce(_id,_key,"id_general_banner_link"),
    _type,
    title,
    "slug": page->slug.current,
    "pagetype": coalesce(page->_type, "generic_page"),
  }
`;

export const pageBannersContentQuery = `
  cookie_banner_configuration {
    ${cookieBannerQueryString}
  },
  general_banner-> {
    ${generalBannerQueryString}
  }
`;

const questionAndAnswerSelectionQuery = `
  ...,
  answers[] {
    ...,
    ${linksContentQuery}
} `;

export const pageContentQuery = `content[hidden!=true] {
  ...,
  blocks[] {
    _type == 'reference' => @->,
    _type == 'testimonials' =>  {
      ...,
      testimonials[]->{
        ...,
        image {
          asset->{
            _id,
            metadata {
              lqip
            }
          }
        }
      },
    },
    _type == 'organizationslist' =>  {
      ...,
      organizations[]->{
        ...,
        "organization_page_slug": organization_page->{
          slug {
            current
          }
        },
      },
    },
    _type == 'opendistributionbutton' =>  {
      ...,
      organization->,
    },
    _type == 'fullvideo' =>  {
      ...,
      video{
        asset->,
      },
    },
    _type == 'links' => {
      ...,
      ${linksContentQuery}
    },
    _type == 'standalonebutton' => {
      ...,
      ${linksContentQuery}
    },
    _type == 'questionandanswergroup' => {
      ${questionAndAnswerSelectionQuery}
    },
    _type == 'columns' => {
      ...,
      columns[] {
        ...,
        richText[] {
          ...,
          markDefs[] {
            ${linksSelectorQuery}
            _type != 'citation' => @ && _type != 'link' && _type != 'navitem',
          }
        },
        links[] {
          ${linksSelectorQuery}
        }
      }
    },
    _type == 'paragraph' => @ {
      ...,
      content[] {
        ...,
        markDefs[] {
          _type == 'citation' => @ {
            ...,
            "citations": citations[]->
          },
          ${linksSelectorQuery}
          _type != 'citation' => @ && _type != 'link' && _type != 'navitem',
        }
      }
    },
    _type == 'splitview' => {
      ...,
      richText[] {
        ...,
        markDefs[] {
          ${linksSelectorQuery}
          _type != 'citation' => @ && _type != 'link' && _type != 'navitem',
        }
      },
      ${linksContentQuery}
    },
    _type == 'splitviewhtml' => {
      ...,
      paragraph[] {
        ...,
        markDefs[] {
          ${linksSelectorQuery}
          _type != 'citation' => @ && _type != 'link' && _type != 'navitem',
        }
      }
    },
    _type == 'wealthcalculator' => {
      ...,
      configuration->{
        ...,
        data_explanation {
          _type == 'reference' => @->{
            ...,
            blocks[] {
              _type == 'paragraph' => @ {
                ...,
                content[] {
                  ...,
                  markDefs[] {
                    _type == 'citation' => @ {
                      ...,
                      "citations": citations[]->
                    },
                    ${linksSelectorQuery}
                    _type != 'citation' => @ && _type != 'link' && _type != 'navitem',
                  }
                }
              },
            }
          },
        },
      },
      impact_configuration->{
        ...,
        intervention_configuration {
          ...,
          output_configuration->{
            ...,
            "donate_label_short": *[ _type == "site_settings"][0].donate_label_short,
            "locale": *[ _type == "site_settings"][0].main_locale,
            explanation_links[] {
              ${linksSelectorQuery}
            },
          },
          "currency": *[ _type == "site_settings"][0].main_currency,
          "locale": *[ _type == "site_settings"][0].main_locale,
        },
      },
      "currency": *[ _type == "site_settings"][0].main_currency,
      "locale": *[ _type == "site_settings"][0].main_locale,
    },
    _type == 'contributorlist' => {
      ...,
      role->,
      contributors[]->{
        ...,
        image {
          asset->{
            _id,
            metadata {
              lqip
            }
          }
        }
      }
    },
    _type == 'inngress' => {
      ...,
      sidelinks[] {
        ${linksSelectorQuery}
      },
    },
    _type == 'wealthcalculatorteaser' => {
      ...,
      button {
        ${linksSelectorQuery}
      },
      "locale": *[ _type == "site_settings"][0].main_locale,
    },
    _type == 'interventionwidget' => {
      ...,
      output_configuration->{
        ...,
        "donate_label_short": *[ _type == "site_settings"][0].donate_label_short,
        "locale": *[ _type == "site_settings"][0].main_locale,
        explanation_links[] {
          ${linksSelectorQuery}
        },
      },
      "currency": *[ _type == "site_settings"][0].main_currency,
      "locale": *[ _type == "site_settings"][0].main_locale,
    },
    _type == 'giftcardteaser' => {
      ...,
      links[] {
        ${linksSelectorQuery}
      },
    },
    _type == 'giftcards' => {
      ...,
      "locale": *[_type == "site_settings"][0].main_locale,
      "currency": *[_type == "site_settings"][0].main_currency,
      giftcards[] {
        ...,
        links[] {
          ${linksSelectorQuery}
        },
      },
    },
    _type == 'normalimage' => {
      ...,
      image {
        asset -> {
          _id,
          metadata {
            lqip,
            dimensions {
              width,
              height
            }
          }
        }
      },
    },
    _type == 'fullimage' => {
      ...,
      image {
        asset -> {
          _id,
          metadata {
            lqip,
            dimensions {
              width,
              height
            }
          }
        }
      },
    },
    _type == 'giveblock' => {
      ...,
      "donate_label_short": *[ _type == "site_settings"][0].donate_label,
      "accent_color": *[ _type == "site_settings"][0].accent_color,
    },
    _type == 'teamintroduction' => {
      ...,
      contributor->{
        ...,
        image {
          asset -> {
            _id,
            metadata {
              lqip
            }
          }
        },
      },
      links {
        links[] {
          ${linksSelectorQuery}
        },
      },
    },
    _type == 'teasers' => {
      ...,
      teasers[] {
        ...,
        image {
          asset -> {
            _id,
            metadata {
              lqip
            }
          }
        },
        links[] {
          ${linksSelectorQuery}
        },
      },
    },
    _type == 'accordion' => {
      ...,
      blocks[] {
        _type == 'paragraph' => @ {
          ...,
          content[] {
            ...,
            markDefs[] {
              _type == 'citation' => @ {
                ...,
                "citations": citations[]->
              },
              ${linksSelectorQuery}
              _type != 'citation' => @ && _type != 'link' && _type != 'navitem',
            }
          }
        },
        _type != 'paragraph' => @,
      }
    },
    _type == 'philantropicteaser' => {
      ...,
      button {
        ...,
        link {
          ${linksSelectorQuery}
        },
      },
      people[]->,
      "locale": *[ _type == "site_settings"][0].main_locale,
    },
    _type == 'plausiblerevenuetracker' => {
      ...,
      "locale": *[ _type == "site_settings"][0].main_locale,
    },
    _type == 'donationwidgetblock' => {
      ...,
      donationwidget->{
        ${widgetContentQuery}
      }
    },
    _type == 'mediacoverageteaser' => {
      ...,
      coverage[] {
        ...,
        publication_logo {
          asset->{
            _id,
            metadata {
              lqip
            }
          }
        },
      },
      read_more_button {
        ...,
        "slug": page->slug.current,
        "pagetype": page->_type,
      },
    },
    _type == 'resultsteaser' => {
      ...,
      see_more_button {
        ...,
        "slug": page->slug.current,
        "pagetype": page->_type,
      },
      "locale": *[ _type == "site_settings"][0].main_locale,
    },
    _type == 'taxdeductionwidget' => {
      ...,
      "locale": *[ _type == "site_settings"][0].main_locale,
    },
    _type == 'newslettersignup' => {
      ...,
      "locale": *[ _type == "site_settings"][0].main_locale,
    },
    _type != 'splitviewhtml' && _type != 'teamintroduction' && _type!= 'fullimage' && _type != 'normalimage' && _type != 'teasers' && _type != 'giveblock' && _type != 'links' && _type != 'standalonebutton' && _type != 'questionandanswergroup' && _type != 'reference' && _type != 'testimonials' && _type != 'organizationslist' && _type != 'opendistributionbutton' && _type != 'fullvideo' && _type!= 'paragraph' && _type != 'splitview' && _type != 'contributorlist' && _type != 'inngress' && _type != 'wealthcalculator' && _type != 'giftcardteaser' && _type != 'giftcards' && _type != 'columns' && _type != 'interventionwidget' && _type != 'wealthcalculatorteaser' && _type != 'accordion' && _type != 'plausiblerevenuetracker' && _type != 'philantropicteaser' && _type != 'mediacoverageteaser' && _type != 'resultsteaser' &&_type != 'taxdeductionwidget' && _type != 'donationwidgetblock' => @,
  }
},
`;
