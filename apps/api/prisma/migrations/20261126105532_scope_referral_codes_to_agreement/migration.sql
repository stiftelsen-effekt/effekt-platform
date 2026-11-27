-- AlterTable
ALTER TABLE `Donation_referral_codes`
    ADD COLUMN `Agreement_provider` VARCHAR(16) NULL,
    ADD COLUMN `Agreement_id` VARCHAR(64) NULL;

-- CreateIndex
CREATE INDEX `Agreement_idx` ON `Donation_referral_codes`(`Agreement_provider`, `Agreement_id`);
