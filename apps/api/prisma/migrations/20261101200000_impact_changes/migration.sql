-- History of edits to the impact data made in the admin (docs/impact-api-migration.md, phase 4):
-- one row per create, update or delete of an estimate, fund grant (with its allotments), charity
-- or intervention (with its texts), with the row as it was before and after. No foreign keys, so
-- the history of a deleted row stays. Written in the same transaction as the edit.
--
-- Rollback: drop the table (nothing reads it but impact.changes.list).

-- CreateTable
CREATE TABLE `Impact_changes` (
    `ID` INTEGER NOT NULL AUTO_INCREMENT,
    `entity` VARCHAR(16) NOT NULL,
    `entity_id` INTEGER NOT NULL,
    `action` VARCHAR(8) NOT NULL,
    `Charity_ID` INTEGER NULL,
    `summary` VARCHAR(255) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `changed_by` VARCHAR(255) NOT NULL,
    `changed_at` DATETIME(0) NOT NULL,

    INDEX `Impact_changes_entity_idx`(`entity`, `entity_id`),
    INDEX `Impact_changes_charity_idx`(`Charity_ID`),
    INDEX `Impact_changes_changed_at_idx`(`changed_at`),
    PRIMARY KEY (`ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
