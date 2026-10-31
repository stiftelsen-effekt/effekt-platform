-- Inflation adjustment offers from the 2024 round that were never sent ('new') or never answered
-- ('pending') expired in Nov-Dec 2024 but kept their status, and an open status blocked the agreement
-- from new offers. Mark them expired; accepted offers are kept. `expires` is written by the app in UTC,
-- so it is compared with UTC_TIMESTAMP() (docs/timestamps.md).
UPDATE `Agreement_inflation_adjustments`
  SET `status` = 'expired'
  WHERE `status` IN ('new', 'pending') AND `expires` < UTC_TIMESTAMP();
