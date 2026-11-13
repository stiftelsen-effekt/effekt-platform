/** What PlausibleRevenueTracker reads from the `plausible` query parameter */
export interface PlausibleTrackingData {
  revenue: string;
  method: string;
  recurring: boolean;
  kid: string;
}

/**
 * Adds the `plausible` query parameter to a "completed" redirect, in the base64 JSON format the
 * PlausibleRevenueTracker block decodes, so the page after the redirect can send the revenue
 * event that the widget no longer gets to send itself.
 */
export const withPlausibleParam = (slug: string, data: PlausibleTrackingData): string => {
  // The data is ASCII (digits, a method name and a boolean), so btoa is safe here.
  const encoded = encodeURIComponent(btoa(JSON.stringify(data)));
  const separator = slug.includes("?") ? "&" : "?";
  return `${slug}${separator}plausible=${encoded}`;
};
