import { usePlausible } from "next-plausible";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { getEstimatedLtv } from "../../../../util/ltv";
import { publicTrpcFor } from "../../../../lib/trpc/client";
import { stegaClean } from "@sanity/client/stega";
import { PaymentMethod } from "../../../shared/components/Widget/types/Enums";

// Define our tracking data interface
interface TrackingData {
  revenue: string;
  method: string;
  recurring: boolean;
  kid: string;
}

export const PlausibleRevenueTracker: React.FC<{
  enabled?: boolean;
  locale: string;
  type: "agreement" | "donation";
}> = ({ enabled, locale, type }) => {
  const plausible = usePlausible();
  const router = useRouter();

  let currency = "NOK";
  if (locale === "sv") {
    currency = "SEK";
  } else if (locale === "dk") {
    currency = "DKK";
  } else if (locale === "et") {
    currency = "EUR";
  }

  useEffect(() => {
    if (enabled) {
      // Try to decode the plausible parameter if it exists
      const { plausible: plausibleParam } = router.query;

      if (plausibleParam) {
        try {
          // Decode the base64 string and parse the JSON
          const trackingData: TrackingData = JSON.parse(
            Buffer.from(plausibleParam as string, "base64").toString("utf-8"),
          );

          const { revenue, method, recurring, kid } = trackingData;

          if (revenue && method && kid) {
            // One thank-you page can receive both one-off donations and new agreements (the
            // Danish site sends every donor to the same page), so the donation's own recurring
            // flag decides the event. The block type is only the fallback.
            const isAgreement = typeof recurring === "boolean" ? recurring : type === "agreement";

            plausible(isAgreement ? "StartedAgreement" : "CompletedDonation", {
              revenue: {
                currency: currency,
                amount: parseFloat(revenue),
              },
              props: {
                method: method,
                recurring: recurring,
                kid: kid,
              },
            });

            if (!isAgreement) {
              // Facebook Pixel tracking
              // @ts-ignore
              if (typeof window.fbq !== "undefined" && window.fbq !== null) {
                // @ts-ignore
                window.fbq("track", "Purchase", {
                  value: revenue,
                  currency: currency,
                });
              }
            } else {
              let paymentMethod: PaymentMethod | undefined;
              if (method.toLowerCase() === "avtalegiro") {
                paymentMethod = PaymentMethod.AVTALEGIRO;
              } else if (method.toLowerCase() === "vipps") {
                paymentMethod = PaymentMethod.VIPPS;
              }

              if (typeof paymentMethod !== "undefined") {
                getEstimatedLtv({
                  method: paymentMethod,
                  sum: parseFloat(revenue),
                  trpc: publicTrpcFor(stegaClean(locale)),
                }).then((ltv) => {
                  // Facebook Pixel tracking
                  // @ts-ignore
                  if (typeof window.fbq !== "undefined" && window.fbq !== null) {
                    // @ts-ignore
                    window.fbq("track", "Subscribe", {
                      value: revenue,
                      currency: currency,
                      predicted_ltv: ltv,
                    });
                  }
                });
              }
            }
          }
        } catch (error) {
          console.error("Failed to parse plausible tracking data:", error);
        }
      }
    }
  }, [router.query, plausible, currency, type, enabled, locale]);

  return null;
};
