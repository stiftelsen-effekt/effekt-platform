import { TaxUnit } from "../../../../../models";
import { useMainLocale } from "../../../../../context/MainLocaleContext";
import { getFormattingLocale, thousandize } from "../../../../../util/formatting";
import { toNumber } from "../../../../../util/decimal";
import { dkDeductionSummary } from "./dkTaxDeductions";
import style from "./DKTaxUnitMobileDetails.module.scss";

/** The expanded Danish tax unit on mobile: the same per-year breakdown as the desktop list. */
export const DKTaxUnitMobileDetails: React.FC<{
  taxUnit: TaxUnit;
  numberOfDonationsLabel: string;
  sumDonationsLabel: string;
  sumTaxDeductionsLabel: string;
  sumTaxBenefitLabel: string;
}> = ({
  taxUnit,
  numberOfDonationsLabel,
  sumDonationsLabel,
  sumTaxDeductionsLabel,
  sumTaxBenefitLabel,
}) => {
  const locale = getFormattingLocale(useMainLocale());
  const kroner = (amount: number) => thousandize(Math.round(amount), locale) + " kr";
  const { years, totals } = dkDeductionSummary(taxUnit);

  return (
    <div className={style.details}>
      <p className={style.count}>
        <span>{numberOfDonationsLabel}</span>
        <span>{thousandize(Math.round(toNumber(taxUnit.numDonations)), locale)}</span>
      </p>
      {years.length > 0 && (
        <table className={style.table} cellSpacing="0">
          <thead>
            <tr>
              <th scope="col">
                <span className={style.visuallyHidden}>År</span>
              </th>
              <th scope="col">{sumDonationsLabel}</th>
              <th scope="col">{sumTaxDeductionsLabel}</th>
              <th scope="col">{sumTaxBenefitLabel}</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <tr key={year.year}>
                <th scope="row">{year.year}</th>
                <td>{kroner(year.sumDonations)}</td>
                <td>{kroner(year.deduction)}</td>
                <td>{kroner(year.benefit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Totalt</th>
              <td>{kroner(totals.sumDonations)}</td>
              <td>{kroner(totals.deduction)}</td>
              <td>{kroner(totals.benefit)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
};
