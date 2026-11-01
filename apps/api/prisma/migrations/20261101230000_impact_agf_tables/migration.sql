-- GiveWell's All Grants Fund (AGF): what the fund granted, as reference data
-- (docs/impact-givewell-numbers.md › All Grants Fund grants). Two tables:
--   Impact_fund_portfolio   the AGF's money per metrics year, organisation and programme, from
--                           GiveWell's yearly metrics reports (sums to each report's AGF total)
--   Impact_givewell_grants  GiveWell grants since August 2022 (write-ups, the AGF page, the impact
--                           estimates sheet), with `funders` = 'AGF' where GiveWell names the fund
-- No donor-facing figure (Min Side, receipts, results page, widget, the compatibility REST)
-- reads them; the Impact_grants/allotments rows that split Top Charities Fund money are untouched.
-- Data: 20261101230100_impact_agf_data.
--
-- Rollback: drop both tables (nothing references them).
-- CreateTable
CREATE TABLE `Impact_fund_portfolio` (
    `ID` INTEGER NOT NULL AUTO_INCREMENT,
    `fund` VARCHAR(8) NOT NULL,
    `metrics_year` SMALLINT NOT NULL,
    `row_key` VARCHAR(191) NOT NULL,
    `organization` VARCHAR(255) NOT NULL,
    `organization_key` VARCHAR(255) NOT NULL,
    `program` VARCHAR(255) NULL,
    `amount_cents` BIGINT UNSIGNED NOT NULL,
    `Organization_ID` INTEGER NULL,
    `source_name` VARCHAR(255) NOT NULL,
    `source_url` TEXT NOT NULL,
    `created_by` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` VARCHAR(255) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `fk_Impact_fund_portfolio_to_Organizations_idx`(`Organization_ID`),
    UNIQUE INDEX `Impact_fund_portfolio_fund_year_row_key`(`fund`, `metrics_year`, `row_key`),
    PRIMARY KEY (`ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Impact_givewell_grants` (
    `ID` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(191) NOT NULL,
    `title` VARCHAR(500) NOT NULL,
    `organization` VARCHAR(255) NOT NULL,
    `organization_key` VARCHAR(255) NOT NULL,
    `Organization_ID` INTEGER NULL,
    `location` VARCHAR(255) NULL,
    `grant_type` VARCHAR(16) NULL,
    `recommended_month` DATE NULL,
    `published_month` DATE NULL,
    `amount_cents` BIGINT UNSIGNED NULL,
    `amount_exact` BOOLEAN NOT NULL DEFAULT false,
    `funders` VARCHAR(255) NULL,
    `fund_amount_cents` BIGINT UNSIGNED NULL,
    `ce_low` DECIMAL(6, 2) NULL,
    `ce_high` DECIMAL(6, 2) NULL,
    `ce_benchmark` VARCHAR(64) NULL,
    `outputs` INTEGER UNSIGNED NULL,
    `output_unit` VARCHAR(255) NULL,
    `cents_per_output` INTEGER UNSIGNED NULL,
    `deaths_averted` INTEGER UNSIGNED NULL,
    `sources` VARCHAR(255) NOT NULL,
    `source_url` TEXT NULL,
    `notes` TEXT NULL,
    `created_by` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` VARCHAR(255) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `Impact_givewell_grants_slug_key`(`slug`),
    INDEX `fk_Impact_givewell_grants_to_Organizations_idx`(`Organization_ID`),
    INDEX `Impact_givewell_grants_recommended_month_idx`(`recommended_month`),
    PRIMARY KEY (`ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Impact_fund_portfolio` ADD CONSTRAINT `fk_Impact_fund_portfolio_to_Organizations` FOREIGN KEY (`Organization_ID`) REFERENCES `Organizations`(`ID`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Impact_givewell_grants` ADD CONSTRAINT `fk_Impact_givewell_grants_to_Organizations` FOREIGN KEY (`Organization_ID`) REFERENCES `Organizations`(`ID`) ON DELETE SET NULL ON UPDATE CASCADE;
