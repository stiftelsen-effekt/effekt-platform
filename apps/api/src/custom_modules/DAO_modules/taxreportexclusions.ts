import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { DAO } from "../DAO";
import { dbClockColumn } from "../osloDays";

/**
 * Tax_report_exclusions: tax units an admin has left out of the year's report to Skatteetaten,
 * with the reason (for example a number Altinn rejected for a donor we can't reach). Leaving a
 * number out records every tax unit that has it; the number stays out of the file only while all
 * its units are left out (exclusionLookup in tax.ts), so a unit that gets the number later (a
 * corrected number, a merge, another donor) is reported rather than dropped unseen.
 */

export type TaxReportExclusionRow = {
  taxUnitId: number;
  reason: string;
  /** Admin (JWT email or sub) who left the unit out */
  createdBy: string;
  created: Date;
};

async function getForYear(year: number): Promise<TaxReportExclusionRow[]> {
  const [rows] = await DAO.query<RowDataPacket[]>(
    `SELECT Tax_unit_ID AS taxUnitId, Reason AS reason, Created_by AS createdBy,
       ${dbClockColumn("Created", "created")}
     FROM Tax_report_exclusions
     WHERE Year = ?`,
    [year],
  );
  return rows.map((row) => ({
    taxUnitId: Number(row.taxUnitId),
    reason: String(row.reason),
    createdBy: String(row.createdBy),
    created: row.created,
  }));
}

/** Leaves the tax units out of the year's report; a unit already left out keeps its reason */
async function exclude(
  year: number,
  taxUnitIds: number[],
  reason: string,
  actor: string,
): Promise<boolean> {
  if (taxUnitIds.length === 0) return false;
  const [result] = await DAO.query<ResultSetHeader>(
    `INSERT IGNORE INTO Tax_report_exclusions (Tax_unit_ID, Year, Reason, Created_by) VALUES ?`,
    [taxUnitIds.map((taxUnitId) => [taxUnitId, year, reason, actor])],
  );
  return result.affectedRows > 0;
}

/** Puts the tax units back in the year's report */
async function include(year: number, taxUnitIds: number[]): Promise<number> {
  if (taxUnitIds.length === 0) return 0;
  const [result] = await DAO.query<ResultSetHeader>(
    `DELETE FROM Tax_report_exclusions WHERE Year = ? AND Tax_unit_ID IN (?)`,
    [year, taxUnitIds],
  );
  return result.affectedRows;
}

export const taxreportexclusions = { getForYear, exclude, include };
