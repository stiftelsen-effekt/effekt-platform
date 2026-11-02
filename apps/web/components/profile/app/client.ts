"use client";

// The existing Min Side and site components that the App Router's Server Components render. They
// use hooks, so they are client components; re-exporting them from this "use client" module makes
// them client references that a Server Component can render with serializable props.

export { MainHeader } from "../../shared/layout/Header/Header";
export { Navbar } from "../../shared/components/Navbar/Navbar";
export { default as Footer } from "../../shared/layout/Footer/Footer";
export { default as DonationYearMenu } from "../donations/YearMenu/YearMenu";
export { ErrorMessage } from "../shared/ErrorMessage/ErrorMessage";
export { default as TaxMenu } from "../tax/TaxMenu/TaxMenu";
export { TaxUnitsTab } from "../tax/TaxUnitsTab/TaxUnitsTab";
export { YearlyReportsTab } from "../tax/YearlyReportsTab/YearlyReportsTab";
export { TaxDeductionsTab } from "../tax/TaxDeductionsTab/TaxDeductionsTab";
export { ProfileInfo } from "../details/ProfileInfo/ProfileInfo";
export { DataInfo } from "../details/DataInfo/DataInfo";
export { MissingNameModal } from "../layout/MissingNameModal/MissingNameModal";
