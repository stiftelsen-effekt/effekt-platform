-- The random code in the recipient's link (gieffektivt.no/gave/<code>)
ALTER TABLE `Giftcards` ADD COLUMN `Code` VARCHAR(16) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Giftcards_Code_key` ON `Giftcards`(`Code`);
