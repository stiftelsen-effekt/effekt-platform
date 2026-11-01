-- GiveWell numbers, corrected and brought up to date (docs/impact-givewell-numbers.md, "The
-- November 2026 update"). Top Charities Fund (TCF) only; the All Grants Fund (AGF) rows are not
-- touched. Sources, per row, are in source_name/source_url:
--
--   TCF  = https://www.givewell.org/top-charities-fund ("Using donations received in", footnotes)
--   ROWS = GiveWell's impact spreadsheet, "Grants by funding opportunity" (cost per output and
--          outputs per grant and funding source), linked from https://www.givewell.org/impact-estimates
--   2024 = the same spreadsheet's "2024 Summary" tab (cost of output, 2024 average, unrounded)
--
-- 1. Grant windows: a TCF grant applies from the first month of the donations it used (TCF).
--    Grants 26, 27, 28 and 33 start in the months GiveWell gives; grant 20's $57M allotment
--    (donations from Oct 2023) moves to a new grant from Oct 2023; grant 27's allotments move to
--    the grants of their donation quarters (Jul-Sep 2024: grant 26; Jan-Mar 2025: grant 29), and
--    its AMF allotment is split into the Q3 and Q4 2024 parts GiveWell gives.
-- 2. Allotments whose cost per output differs by more than 5 % from GiveWell's figure for that
--    grant (ROWS), or whose sum is not GiveWell's TCF amount, take GiveWell's sum and outputs.
-- 3. A new TCF grant from Jan 2026 (AMF, DRC 2027-29, $48.9M of Q1 2026 donations, about $6 per
--    net) and a 2024 estimate for AMF, MC, NI and HKI (2024).
--
-- Every changed row gets an Impact_changes row (changed_by
-- 'migration:20261101233000_impact_givewell_update', the row before and after as the admin's history stores it), so the admin's
-- change log shows the edits. All or nothing: the edits apply only if every row they touch still
-- holds the values of the impact tables migration (20261101120000); otherwise nothing changes
-- (scripts/impact-givewell-update.sql checks the result). New grants and allotments get the next
-- IDs; the new grants get the TCF's next legacy IDs (34 for Oct 2023, 35 for Jan 2026).
--
-- Rollback: the Impact_changes rows of this migration hold every row's values before it.

CREATE OR REPLACE VIEW `Impact_migration_grant_snapshot` AS
SELECT G.ID,
       JSON_OBJECT(
         'id', G.ID,
         'fund', G.fund,
         'validFrom', DATE_FORMAT(G.valid_from, '%Y-%m-%d'),
         'legacyId', G.legacy_id,
         'allotments', COALESCE(
           (SELECT JSON_ARRAYAGG(JSON_OBJECT(
                     'id', A.ID,
                     'charityId', A.Charity_ID,
                     'interventionId', A.Intervention_ID,
                     'sumInCents', A.sum_in_cents,
                     'numberOutputsPurchased', A.number_outputs_purchased,
                     'numberOutputsPurchasedLowerBound', A.number_outputs_purchased_lower_bound,
                     'numberOutputsPurchasedUpperBound', A.number_outputs_purchased_upper_bound,
                     'sourceName', A.source_name,
                     'sourceUrl', A.source_url,
                     'comment', A.comment))
              FROM Impact_grant_allotments A WHERE A.Grant_ID = G.ID),
           JSON_ARRAY())
       ) AS snapshot,
       CONCAT(G.fund, ' grant from ', DATE_FORMAT(G.valid_from, '%b %Y')) AS summary
  FROM Impact_grants G;

CREATE OR REPLACE VIEW `Impact_migration_estimate_snapshot` AS
SELECT E.ID, E.Charity_ID,
       JSON_OBJECT(
         'id', E.ID,
         'charityId', E.Charity_ID,
         'interventionId', E.Intervention_ID,
         'validFrom', DATE_FORMAT(E.valid_from, '%Y-%m-%d'),
         'centsPerOutput', E.cents_per_output,
         'centsPerOutputLowerBound', E.cents_per_output_lower_bound,
         'centsPerOutputUpperBound', E.cents_per_output_upper_bound,
         'sourceName', E.source_name,
         'sourceUrl', E.source_url,
         'comment', E.comment
       ) AS snapshot,
       CONCAT(C.abbreviation, ' estimate from ', DATE_FORMAT(E.valid_from, '%b %Y')) AS summary
  FROM Impact_evaluations E JOIN Impact_charities C ON C.ID = E.Charity_ID;

START TRANSACTION;

SET @who = _utf8mb4'migration:20261101233000_impact_givewell_update' COLLATE utf8mb4_unicode_ci;

-- The guard: every row this migration edits still as the impact tables migration left it
SET @apply = (
  (SELECT COUNT(*) FROM Impact_grant_allotments
    WHERE (ID, Grant_ID, sum_in_cents, number_outputs_purchased) IN (
      (3, 2, 1170000000, 236364),
      (9, 6, 940000000, 80342),
      (10, 6, 228066100, 506814),
      (15, 8, 941100000, 107850),
      (20, 9, 2146763700, 241082),
      (27, 15, 1510000000, 83541),
      (29, 17, 1110000000, 61411),
      (30, 18, 1680000000, 5698460),
      (31, 19, 780000000, 87594),
      (32, 19, 780000000, 922812),
      (33, 20, 110000000, 1301402),
      (34, 20, 900000000, 1101591),
      (35, 20, 5700000000, 6976744),
      (37, 27, 109734200, 43862),
      (38, 27, 90000000, 8531),
      (39, 27, 2900000000, 5118700),
      (41, 26, 290000000, 1133116),
      (42, 28, 1100000000, 2609031),
      (44, 27, 2120000000, 7691565))) = 19
  AND (SELECT COUNT(*) FROM Impact_grants
        WHERE fund = 'TCF' AND (ID, legacy_id, valid_from) IN (
          (2, 2, '2020-01-01'), (6, 6, '2021-04-01'), (8, 8, '2021-10-01'), (9, 9, '2022-01-01'),
          (15, 15, '2022-07-01'), (17, 17, '2023-01-01'), (18, 18, '2023-02-01'),
          (19, 19, '2023-04-01'), (20, 20, '2024-01-01'), (26, 26, '2024-03-01'),
          (27, 27, '2024-04-01'), (28, 28, '2024-02-01'), (29, 29, '2025-01-01'),
          (33, 33, '2025-02-01'))) = 14
  AND (SELECT COUNT(*) FROM Impact_grants
        WHERE fund = 'TCF'
          AND valid_from IN ('2023-10-01', '2024-07-01', '2024-10-01', '2025-04-01', '2026-01-01')) = 0
  AND (SELECT COUNT(*) FROM Impact_evaluations
        WHERE valid_from = '2024-01-01' AND Charity_ID IN (1, 3, 4, 10)) = 0
  AND (SELECT COUNT(*) FROM Impact_evaluations
        WHERE ID = 77 AND Charity_ID = 4 AND valid_from = '2023-01-01' AND cents_per_output = 13274
          AND source_url = 'https://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=386901628#gid=386901628') = 1
);

-- History, part 1: the edited rows as they are now (`after` is filled in at the end)
INSERT INTO Impact_changes (entity, entity_id, action, Charity_ID, summary, `before`, `after`, changed_by, changed_at)
SELECT 'grant', S.ID, 'update', NULL, S.summary, S.snapshot, NULL, @who, UTC_TIMESTAMP()
  FROM Impact_migration_grant_snapshot S
 WHERE @apply AND S.ID IN (2, 6, 8, 9, 15, 17, 18, 19, 20, 26, 27, 28, 29, 33)
 ORDER BY S.ID;

INSERT INTO Impact_changes (entity, entity_id, action, Charity_ID, summary, `before`, `after`, changed_by, changed_at)
SELECT 'estimate', S.ID, 'update', S.Charity_ID, S.summary, S.snapshot, NULL, @who, UTC_TIMESTAMP()
  FROM Impact_migration_estimate_snapshot S
 WHERE @apply AND S.ID = 77;

-- 1. Grant windows (in this order: one grant per fund and month)
UPDATE Impact_grants SET valid_from = '2025-04-01', updated_by = @who, updated_at = UTC_TIMESTAMP()
 WHERE @apply AND ID = 33; -- MC Chad (Jun 2025), AMF Ituri (Aug 2025): donations Apr-Jun 2025
UPDATE Impact_grants SET valid_from = '2024-10-01', updated_by = @who, updated_at = UTC_TIMESTAMP()
 WHERE @apply AND ID = 27; -- AMF Chad, DRC, Nigeria, Zambia (Dec 2024): Q4 2024 part
UPDATE Impact_grants SET valid_from = '2024-04-01', updated_by = @who, updated_at = UTC_TIMESTAMP()
 WHERE @apply AND ID = 28; -- AMF DRC (Jun 2024): donations late Mar-Jun 2024
UPDATE Impact_grants SET valid_from = '2024-07-01', updated_by = @who, updated_at = UTC_TIMESTAMP()
 WHERE @apply AND ID = 26; -- HKI (Aug 2024), MC Karamoja (Sep 2024): donations Jul-Sep 2024
UPDATE Impact_grants SET updated_by = @who, updated_at = UTC_TIMESTAMP()
 WHERE @apply AND ID IN (2, 6, 8, 9, 15, 17, 18, 19, 20, 29);

INSERT INTO Impact_grants (fund, valid_from, legacy_id, created_by)
SELECT 'TCF', '2023-10-01', L.next_id, @who
  FROM (SELECT MAX(legacy_id) + 1 AS next_id FROM Impact_grants WHERE fund = 'TCF') L
 WHERE @apply;
SET @grant_2023_10 = (SELECT ID FROM Impact_grants WHERE fund = 'TCF' AND valid_from = '2023-10-01');

-- 2. Allotments: GiveWell's sum and outputs for the grant
UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  number_outputs_purchased = 2405036,
  source_name = CONCAT(source_name, '\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 467 (TCF Q1 and Q2 2020)'),
  source_url = CONCAT(source_url, '\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A467:Y467'),
  comment = '2026-11: outputs were 236,364 (a lost digit: $49.50 per net); GiveWell: $4.86 per net, 2,405,036 nets'
 WHERE @apply AND ID = 3;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  number_outputs_purchased = 66113,
  source_name = CONCAT(source_name, '\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 342 (TCF Q2 2021)'),
  source_url = CONCAT(source_url, '\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A342:Y342'),
  comment = '2026-11: outputs were 80,342 ($117.00 per child); GiveWell: $142 per child, 66,113'
 WHERE @apply AND ID = 9;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  number_outputs_purchased = 467349,
  source_name = CONCAT(source_name, '\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 343 (TCF Q2 2021)'),
  source_url = CONCAT(source_url, '\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A343:Y343'),
  comment = '2026-11: outputs were 506,814 ($4.50 per net); GiveWell: $4.88 per net, 467,349'
 WHERE @apply AND ID = 10;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  number_outputs_purchased = 53128,
  source_name = 'GiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 373 (TCF Q4 2021)',
  source_url = 'https://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A373:Y373\nhttps://www.givewell.org/research/grants/new-incentives-nigeria-January-2022',
  comment = '2026-11: outputs were 107,850 ($87.26 per child); GiveWell: $177 per child, 53,128'
 WHERE @apply AND ID = 15;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  number_outputs_purchased = 119946,
  source_name = 'GiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 243 (TCF Q1 2022)',
  source_url = 'https://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A243:Y243\nhttps://www.givewell.org/research/grants/new-incentives-nigeria-expansion-may-2022',
  comment = '2026-11: outputs were 241,082 ($89.05 per child); GiveWell: $179 per child, 119,946'
 WHERE @apply AND ID = 20;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  sum_in_cents = 1512641700,
  number_outputs_purchased = 118534,
  source_name = 'GiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 256 (TCF Q3 2022)',
  source_url = 'https://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A256:Y256\nhttps://www.givewell.org/research/grants/new-incentives-nigeria-expansion-november-2022',
  comment = '2026-11: was $15,100,000 for 83,541 ($180.75 per child); GiveWell: $15,126,417, $128 per child, 118,534'
 WHERE @apply AND ID = 27;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  sum_in_cents = 1112148400,
  number_outputs_purchased = 77972,
  source_name = 'GiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" rows 180-190 (New Incentives May 2023, TCF)',
  source_url = 'https://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A180:Y190\nhttps://www.givewell.org/research/grants/new-incentives-nigeria-expansion-extension-may-2023',
  comment = '2026-11: was $11,100,000 for 61,411 ($180.75 per child); GiveWell: $142.63 per child, 77,972 (sum of the funding opportunities)'
 WHERE @apply AND ID = 29;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  sum_in_cents = 1679946000,
  number_outputs_purchased = 2871703,
  source_name = CONCAT(source_name, '\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 178 (TCF AMF DRC June 2023)'),
  source_url = CONCAT(source_url, '\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A178:Y178'),
  comment = '2026-11: was 5,698,460 nets ($2.95 per net); GiveWell: $16,799,460, $5.85 per net, 2,871,703'
 WHERE @apply AND ID = 30;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  sum_in_cents = 782027600,
  number_outputs_purchased = 65499,
  source_name = 'GiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 226 (New Incentives November 2023, TCF)',
  source_url = 'https://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A226:Y226\nhttps://www.givewell.org/research/grants/new-incentives-top-charity-november-2023-program-additions-april-2024',
  comment = '2026-11: was $7,800,000 for 87,594 ($89.05 per child); GiveWell: $7,820,276, $119.40 per child, 65,499'
 WHERE @apply AND ID = 31;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  sum_in_cents = 782007600,
  number_outputs_purchased = 1018750,
  source_name = CONCAT(source_name, '\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" rows 224-225 (Malaria Consortium November 2023, TCF)'),
  source_url = CONCAT(source_url, '\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A224:Y225'),
  comment = '2026-11: was $7,800,000 for 922,812 ($8.45 per child); GiveWell: $6,392,822 at $7.19 and $1,427,254 at $11.03, 1,018,750 in all'
 WHERE @apply AND ID = 32;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  sum_in_cents = 1205886700,
  number_outputs_purchased = 1470845,
  source_name = 'Malaria Consortium — SMC in Karamoja, Uganda in 2024 and Nampula, Mozambique in 2024-2025 (Nov 2023-Jan 2024)\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 235 (Malaria Consortium January 2024, TCF, donations 9 Jan-28 Mar 2024)',
  source_url = 'https://www.givewell.org/research/grants/malaria-consortium-smc-karamoja-uganda-nampula-mozambique-november-2023-january-2024\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A235:Y235',
  comment = '2026-11: sum was $1,100,000 (a lost digit: $0.85 per child); GiveWell: $12,058,867, $8.20 per child, 1,470,845'
 WHERE @apply AND ID = 33;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  sum_in_cents = 902440900,
  number_outputs_purchased = 1506579,
  source_name = 'Malaria Consortium — SMC Renewals in Nigeria, Burkina Faso, and Togo (January - March 2024)\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 11 (Malaria Consortium March 2024, TCF, donations 9 Jan-28 Mar 2024)',
  source_url = 'https://www.givewell.org/research/grants/malaria-consortium-smc-renewals-in-sahel-countries-january-march-2024\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A11:Y11',
  comment = '2026-11: was $9,000,000 for 1,101,591 ($8.17 per child); GiveWell: $9,024,409, $5.99 per child, 1,506,579'
 WHERE @apply AND ID = 34;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  Grant_ID = @grant_2023_10,
  sum_in_cents = 5704495800,
  number_outputs_purchased = 7200984,
  source_name = 'Malaria Consortium — SMC Renewals in Nigeria, Burkina Faso, and Togo (January - March 2024)\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 5 (Malaria Consortium March 2024, TCF, donations 1 Oct 2023-9 Jan 2024)',
  source_url = 'https://www.givewell.org/research/grants/malaria-consortium-smc-renewals-in-sahel-countries-january-march-2024\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A5:Y5\nhttps://www.givewell.org/top-charities-fund',
  comment = '2026-11: moved from the grant from Jan 2024 (donations Oct 2023-early Jan 2024); was $57,000,000 for 6,976,744 ($8.17 per child); GiveWell: $57,044,958, $7.92 per child, 7,200,984'
 WHERE @apply AND ID = 35;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  Grant_ID = 26,
  sum_in_cents = 108734200,
  source_name = CONCAT(source_name, '\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 13 (Malaria Consortium September 2024, TCF)'),
  source_url = CONCAT(source_url, '\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A13:Y13'),
  comment = '2026-11: moved from the grant from Apr 2024 (donations Jul-Sep 2024); sum was $1,097,342; GiveWell: $1,087,342, $24.79 per child'
 WHERE @apply AND ID = 37;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  Grant_ID = 26,
  sum_in_cents = 90011300,
  number_outputs_purchased = 6604,
  source_name = CONCAT(source_name, '\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 159 (New Incentives October 2024, TCF)'),
  source_url = CONCAT(source_url, '\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A159:Y159'),
  comment = '2026-11: moved from the grant from Apr 2024 (donations Jul-Sep 2024); was $900,000 for 8,531 ($105.50 per child); GiveWell: $900,113, $136.30 per child, 6,604'
 WHERE @apply AND ID = 38;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  sum_in_cents = 2820000000,
  number_outputs_purchased = 4979254,
  source_name = 'Against Malaria Foundation — Support for ITN Campaigns in Chad, DRC, Nigeria, and Zambia (December 2024): Q4 2024 part\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 139 (Against Malaria Foundation December 2024, TCF)',
  source_url = 'https://www.givewell.org/research/grants/against-malaria-foundation-support-for-itn-campaigns-in-chad-drc-nigeria-and-zambia-december-2024\nhttps://www.givewell.org/top-charities-fund\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A139:Y139',
  comment = '2026-11: was $29,000,000 for 5,118,700 (from a GiveWell email of Feb 2025); TCF page: $28.2M of Q4 2024 donations ($830,000 of Q3 is in the grant from Jul 2024); GiveWell: $5.66 per net ($28,271,964 for 4,991,962)'
 WHERE @apply AND ID = 39;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  sum_in_cents = 288729700,
  number_outputs_purchased = 784169,
  source_name = CONCAT(source_name, '\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 73 (Helen Keller Intl August 2024, TCF)'),
  source_url = CONCAT(source_url, '\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A73:Y73'),
  comment = CONCAT(comment, '\n2026-11: was $2,900,000 for 1,133,116 ($2.56 per child); GiveWell: $2,887,297, $3.68 per child, 784,169')
 WHERE @apply AND ID = 41;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  sum_in_cents = 964209300,
  number_outputs_purchased = 1295980,
  source_name = CONCAT(source_name, '\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 133 (Against Malaria Foundation June 2024, TCF)'),
  source_url = CONCAT(source_url, '\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A133:Y133'),
  comment = '2026-11: was $11,000,000 for 2,609,031 ($4.22 per net); GiveWell: $9,642,093, $7.44 per net, 1,295,980'
 WHERE @apply AND ID = 42;

UPDATE Impact_grant_allotments SET
  updated_by = @who, updated_at = UTC_TIMESTAMP(),
  Grant_ID = 29,
  sum_in_cents = 2118174200,
  number_outputs_purchased = 9368561,
  source_name = CONCAT(source_name, '\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 17 (Helen Keller Intl December 2024, TCF)'),
  source_url = 'https://www.givewell.org/research/grants/Helen-Keller-Intl-Vitamin-A-Supplementation-December-2024\nhttps://docs.google.com/spreadsheets/d/1L6D1mf8AMKoUHrN0gBGiJjtstic4RvqLZCxXZ99kdnA/edit?gid=2109982948#gid=2109982948\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A17:Y17',
  comment = CONCAT(comment, '\n2026-11: moved from the grant from Apr 2024 (donations Jan-Mar 2025); was $21,200,000 for 7,691,565 ($2.76 per child); GiveWell: $21,181,742, $2.26 per child, 9,368,561')
 WHERE @apply AND ID = 44;

-- AMF's Q3 2024 part of the December 2024 grant (TCF page, footnote 11), at that grant's cost per net
INSERT INTO Impact_grant_allotments (Grant_ID, Charity_ID, Intervention_ID, sum_in_cents, number_outputs_purchased,
  number_outputs_purchased_lower_bound, number_outputs_purchased_upper_bound, source_name, source_url, comment, created_by)
SELECT 26, 1, 2, 83000000, 146553, 0, NULL,
  'Against Malaria Foundation — Support for ITN Campaigns in Chad, DRC, Nigeria, and Zambia (December 2024): Q3 2024 part\nGiveWell, directed grants to top charities with impact information, "Grants by funding opportunity" row 139 (Against Malaria Foundation December 2024, TCF)',
  'https://www.givewell.org/research/grants/against-malaria-foundation-support-for-itn-campaigns-in-chad-drc-nigeria-and-zambia-december-2024\nhttps://www.givewell.org/top-charities-fund\nhttps://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=0#gid=0&range=A139:Y139',
  '2026-11: TCF page: about $830,000 of Q3 2024 donations; outputs at GiveWell''s $5.66 per net for the grant ($28,271,964 for 4,991,962)',
  @who
 WHERE @apply;

-- 3. New: TCF grant from Jan 2026 (AMF, DRC 2027-29; $48.9M of Q1 2026 donations, about $6 per net)
INSERT INTO Impact_grants (fund, valid_from, legacy_id, created_by)
SELECT 'TCF', '2026-01-01', L.next_id, @who
  FROM (SELECT MAX(legacy_id) + 1 AS next_id FROM Impact_grants WHERE fund = 'TCF') L
 WHERE @apply;
SET @grant_2026_01 = (SELECT ID FROM Impact_grants WHERE fund = 'TCF' AND valid_from = '2026-01-01');

INSERT INTO Impact_grant_allotments (Grant_ID, Charity_ID, Intervention_ID, sum_in_cents, number_outputs_purchased,
  number_outputs_purchased_lower_bound, number_outputs_purchased_upper_bound, source_name, source_url, comment, created_by)
SELECT @grant_2026_01, 1, 2, 4890000000, 8150000, 0, NULL,
  'Against Malaria Foundation — ITN Campaigns in DRC in 2027-2029 (May 2026): Q1 2026 part',
  'https://www.givewell.org/research/grants/Against-Malaria-Foundation-ITN-Campaigns-in-DRC-in-2027-2029-May-2026\nhttps://www.givewell.org/top-charities-fund',
  '2026-11: TCF page: $48.9M of Q1 2026 donations (and $9M of Q4 2025, not entered: the other Q4 2025 grants have no grant page yet); grant page: "about $6 for each counterfactually additional net"', @who
 WHERE @apply AND @grant_2026_01 IS NOT NULL;

-- Estimates: GiveWell's 2024 averages (2024 Summary), as the 2022 and 2023 estimates
INSERT INTO Impact_evaluations (Charity_ID, Intervention_ID, valid_from, cents_per_output,
  cents_per_output_lower_bound, cents_per_output_upper_bound, source_name, source_url, comment, created_by)
SELECT V.charity, V.intervention, '2024-01-01', V.cents, 0, NULL,
  'GiveWell directed grants to top charities with impact information (2020 onward) (public), "2024 Summary": cost of output, 2024 average',
  'https://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=1846397371#gid=1846397371\nhttps://www.givewell.org/impact-estimates',
  V.comment, @who
  FROM (
    SELECT 1 AS charity, 2 AS intervention, 610 AS cents, 'AMF, 2024: $6.10 per net ($137,326,393 directed)' AS comment
    UNION ALL SELECT 10, 1, 795, 'Malaria Consortium, 2024: $7.95 per child ($78,296,482 directed)'
    UNION ALL SELECT 4, 5, 13630, 'New Incentives, 2024: $136.30 per infant ($1,289,969 directed)'
    UNION ALL SELECT 3, 3, 252, 'Helen Keller Intl, 2024: $2.52 per child ($32,011,125 directed)'
  ) V
 WHERE @apply;

-- A wrong link: NI's 2023 estimate ($132.74) is in the 2023 Summary, not the 2022 one
UPDATE Impact_evaluations SET
  source_url = 'https://docs.google.com/spreadsheets/d/1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo/edit?gid=334891838#gid=334891838',
  updated_by = @who, updated_at = UTC_TIMESTAMP()
 WHERE @apply AND ID = 77;

-- History, part 2: the edited rows after, and the new ones
UPDATE Impact_changes C JOIN Impact_migration_grant_snapshot S ON S.ID = C.entity_id
   SET C.`after` = S.snapshot, C.summary = S.summary
 WHERE C.changed_by = @who AND C.entity = 'grant' AND C.action = 'update' AND C.`after` IS NULL;

UPDATE Impact_changes C JOIN Impact_migration_estimate_snapshot S ON S.ID = C.entity_id
   SET C.`after` = S.snapshot, C.summary = S.summary
 WHERE C.changed_by = @who AND C.entity = 'estimate' AND C.action = 'update' AND C.`after` IS NULL;

INSERT INTO Impact_changes (entity, entity_id, action, Charity_ID, summary, `before`, `after`, changed_by, changed_at)
SELECT 'grant', S.ID, 'create', NULL, S.summary, NULL, S.snapshot, @who, UTC_TIMESTAMP()
  FROM Impact_migration_grant_snapshot S JOIN Impact_grants G ON G.ID = S.ID
 WHERE @apply AND G.created_by = @who
 ORDER BY S.ID;

INSERT INTO Impact_changes (entity, entity_id, action, Charity_ID, summary, `before`, `after`, changed_by, changed_at)
SELECT 'estimate', S.ID, 'create', S.Charity_ID, S.summary, NULL, S.snapshot, @who, UTC_TIMESTAMP()
  FROM Impact_migration_estimate_snapshot S JOIN Impact_evaluations E ON E.ID = S.ID
 WHERE @apply AND E.created_by = @who
 ORDER BY S.ID;

COMMIT;

DROP VIEW `Impact_migration_grant_snapshot`;
DROP VIEW `Impact_migration_estimate_snapshot`;
