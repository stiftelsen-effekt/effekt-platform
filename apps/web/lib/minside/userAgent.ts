/**
 * The user agent's guess of a phone, for the server render of Min Side pages
 * (MinsidePageProviders → MobileGuessContext, hooks/useIsMobile.ts)
 */
export const isMobileUserAgent = (userAgent: string) => /Mobi|Android/i.test(userAgent);
