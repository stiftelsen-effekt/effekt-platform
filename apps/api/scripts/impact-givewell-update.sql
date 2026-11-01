-- Checks the result of migration 20261101233000_impact_givewell_update (read-only, one statement):
-- one row per check, `ok` = 1 when the tables hold what the migration should have left. Run it
-- with any read-only user, e.g. on production after the deploy, or locally (the DB spec
-- src/__test__/DAO/impactGivewellUpdate.db.spec.ts runs it). The All Grants Fund is not checked:
-- its rows are not this migration's.
--
-- Top Charities Fund grants: month, legacy ID, and per allotment (in ID order) charity, USD cents
-- and outputs.
WITH expected_grants_raw (month, legacy_id, allotments) AS (
  VALUES
  ROW('2018-10', 14, 'MC 760000000/1065919'),
  ROW('2019-01', 13, 'AMF 470000000/1037528'),
  ROW('2019-04', 12, 'AMF 230000000/507726'),
  ROW('2019-07', 11, 'HKI 260000000/2131148'),
  ROW('2019-10', 1, 'MC 1190000000/1586667, HKI 150000000/1219512'),
  ROW('2020-01', 2, 'AMF 1170000000/2405036'),
  ROW('2020-07', 3, 'MC 380000000/548341'),
  ROW('2020-10', 4, 'AMF 2590000000/4743590'),
  ROW('2021-01', 5, 'AMF 104603100/188814, HKI 1100000000/10000000, SS 150000000/877193'),
  ROW('2021-04', 6, 'NI 940000000/66113, AMF 228066100/467349, MC 228066100/330531'),
  ROW('2021-07', 7, 'AMF 877077600/1838737'),
  ROW('2021-10', 8, 'SS 784111600/9611284, DTW 483165700/6952915, NI 941100000/53128, AMF 344617200/643878, MC 2218020500/3151890, HKI 139424200/1317164'),
  ROW('2022-01', 9, 'HKI 178930900/1690394, NI 2146763700/119946, AMF 816383500/1481640'),
  ROW('2022-04', 10, 'MC 840000000/1079692'),
  ROW('2022-07', 15, 'NI 1512641700/118534'),
  ROW('2022-10', 16, 'MC 2360000000/3676012'),
  ROW('2023-01', 17, 'NI 1112148400/77972'),
  ROW('2023-02', 18, 'AMF 1679946000/2871703'),
  ROW('2023-04', 19, 'NI 782027600/65499, MC 782007600/1018750'),
  ROW('2023-10', 34, 'MC 5704495800/7200984'),
  ROW('2024-01', 20, 'MC 1205886700/1470845, MC 902440900/1506579'),
  ROW('2024-04', 28, 'AMF 964209300/1295980'),
  ROW('2024-07', 26, 'MC 273148000/195245, MC 108734200/43862, NI 90011300/6604, HKI 288729700/784169, AMF 83000000/146553'),
  ROW('2024-10', 27, 'AMF 2820000000/4979254'),
  ROW('2025-01', 29, 'NI 1210000000/134808, HKI 2118174200/9368561'),
  ROW('2025-04', 33, 'MC 890000000/925156, AMF 360000000/565149'),
  ROW('2026-01', 35, 'AMF 4890000000/8150000')
),
expected_grants AS (
  SELECT month COLLATE utf8mb4_unicode_ci AS month, legacy_id,
         allotments COLLATE utf8mb4_unicode_ci AS allotments
    FROM expected_grants_raw
),
actual_grants AS (
  SELECT DATE_FORMAT(G.valid_from, '%Y-%m') AS month, G.legacy_id,
         GROUP_CONCAT(CONCAT(C.abbreviation, ' ', A.sum_in_cents, '/', A.number_outputs_purchased)
                      ORDER BY A.ID SEPARATOR ', ') AS allotments
    FROM Impact_grants G
    LEFT JOIN Impact_grant_allotments A ON A.Grant_ID = G.ID
    LEFT JOIN Impact_charities C ON C.ID = A.Charity_ID
   WHERE G.fund = 'TCF'
   GROUP BY G.ID
),
-- Each charity's newest estimate: month and USD cents per output
expected_newest_raw (abbreviation, month, cents) AS (
  VALUES
  ROW('AMF', '2024-01', 610), ROW('MC', '2024-01', 795), ROW('NI', '2024-01', 13630),
  ROW('HKI', '2024-01', 252), ROW('SCI', '2019-04', 103), ROW('DTW', '2020-11', 72),
  ROW('SS', '2020-01', 92), ROW('GD', '2018-03', 120), ROW('UBI', '2018-03', 120),
  ROW('END', '2018-01', 81), ROW('NLS', '2017-11', 1870), ROW('PHC', '2016-02', 5),
  ROW('GDZF', '2023-04', 100), ROW('GDCSF', '2023-01', 115)
),
expected_newest AS (
  SELECT abbreviation COLLATE utf8mb4_unicode_ci AS abbreviation,
         month COLLATE utf8mb4_unicode_ci AS month, cents
    FROM expected_newest_raw
),
actual_newest AS (
  SELECT C.abbreviation, DATE_FORMAT(E.valid_from, '%Y-%m') AS month, E.cents_per_output AS cents
    FROM Impact_evaluations E JOIN Impact_charities C ON C.ID = E.Charity_ID
   WHERE E.valid_from = (SELECT MAX(valid_from) FROM Impact_evaluations X WHERE X.Charity_ID = E.Charity_ID)
)
SELECT CONCAT('TCF grant ', e.month) COLLATE utf8mb4_unicode_ci AS what,
       CONCAT(e.legacy_id, ': ', e.allotments) COLLATE utf8mb4_unicode_ci AS expected,
       CONCAT(a.legacy_id, ': ', a.allotments) COLLATE utf8mb4_unicode_ci AS actual,
       COALESCE(e.legacy_id = a.legacy_id AND e.allotments = a.allotments, 0) AS ok
  FROM expected_grants e LEFT JOIN actual_grants a ON a.month = e.month
UNION ALL
SELECT CONCAT('TCF grant ', a.month, ' (not expected)') COLLATE utf8mb4_unicode_ci, NULL,
       CONCAT(a.legacy_id, ': ', a.allotments) COLLATE utf8mb4_unicode_ci, 0
  FROM actual_grants a WHERE a.month NOT IN (SELECT month FROM expected_grants)
UNION ALL
SELECT CONCAT('Newest estimate ', e.abbreviation) COLLATE utf8mb4_unicode_ci,
       CONCAT(e.month, ' ', e.cents) COLLATE utf8mb4_unicode_ci,
       CONCAT(a.month, ' ', a.cents) COLLATE utf8mb4_unicode_ci,
       COALESCE(e.month = a.month AND e.cents = a.cents, 0)
  FROM expected_newest e LEFT JOIN actual_newest a ON a.abbreviation = e.abbreviation
UNION ALL
SELECT 'Estimates' COLLATE utf8mb4_unicode_ci, '64' COLLATE utf8mb4_unicode_ci,
       CAST(COUNT(*) AS CHAR) COLLATE utf8mb4_unicode_ci, COUNT(*) = 64
  FROM Impact_evaluations
UNION ALL
SELECT 'NI 2023 estimate link' COLLATE utf8mb4_unicode_ci, 'gid=334891838' COLLATE utf8mb4_unicode_ci,
       SUBSTRING_INDEX(source_url, 'edit?', -1) COLLATE utf8mb4_unicode_ci,
       source_url LIKE '%gid=334891838#gid=334891838'
  FROM Impact_evaluations WHERE ID = 77
UNION ALL
SELECT 'History rows of the migration' COLLATE utf8mb4_unicode_ci,
       '21: 14 grant edits, 1 estimate edit, 2 new grants, 4 new estimates' COLLATE utf8mb4_unicode_ci,
       CONCAT(COUNT(*), ': ', SUM(entity = 'grant' AND action = 'update'), ', ',
              SUM(entity = 'estimate' AND action = 'update'), ', ', SUM(entity = 'grant' AND action = 'create'),
              ', ', SUM(entity = 'estimate' AND action = 'create')) COLLATE utf8mb4_unicode_ci,
       COUNT(*) = 21 AND SUM(entity = 'grant' AND action = 'update') = 14 AND SUM(`after` IS NULL) = 0
  FROM Impact_changes WHERE changed_by = 'migration:20261101233000_impact_givewell_update'
UNION ALL
SELECT 'Every TCF allotment from 2023 has a source link' COLLATE utf8mb4_unicode_ci,
       '0 without' COLLATE utf8mb4_unicode_ci, CAST(COUNT(*) AS CHAR) COLLATE utf8mb4_unicode_ci, COUNT(*) = 0
  FROM Impact_grant_allotments A JOIN Impact_grants G ON G.ID = A.Grant_ID
 WHERE G.fund = 'TCF' AND G.valid_from >= '2023-01-01' AND A.source_url NOT LIKE '%http%';
