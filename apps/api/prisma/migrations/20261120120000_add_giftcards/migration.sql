-- Gift cards (gavekort): a donation to one organization bought as a gift. The buyer pays a
-- normal donation on its own KID; the gift card row on that KID says what it was (product,
-- number of units), who it is for, and whether and when an SMS goes to the recipient.
-- Products hold what must not come from the browser: organization, price per unit and the
-- SMS text. Pages, pictures and the self-fill PDF are in Sanity, linked by Slug.
-- Giftcards uses Distributions' collation (utf8mb4_0900_ai_ci), which the KID foreign key needs.
-- Additive: new tables only. Products are configuration, added per environment (devdata seeds
-- them locally); this migration inserts none.

-- CreateTable
CREATE TABLE `Giftcard_products` (
    `ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Slug` VARCHAR(64) NOT NULL,
    `Name` VARCHAR(255) NOT NULL,
    `Organization_ID` INTEGER NOT NULL,
    `Unit_price` DECIMAL(10, 2) NOT NULL,
    `Unit_singular` VARCHAR(64) NOT NULL,
    `Unit_plural` VARCHAR(64) NOT NULL,
    `Min_units` INTEGER NOT NULL DEFAULT 1,
    `Max_units` INTEGER NOT NULL DEFAULT 1000,
    `Sms_template` TEXT NOT NULL,
    `Active` BOOLEAN NOT NULL DEFAULT true,
    `Created` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `Last_updated` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `Giftcard_products_Slug_key`(`Slug`),
    INDEX `fk_Giftcard_products_to_Organizations_idx`(`Organization_ID`),
    PRIMARY KEY (`ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Giftcards` (
    `ID` INTEGER NOT NULL AUTO_INCREMENT,
    `KID` VARCHAR(32) NOT NULL,
    `Product_ID` INTEGER NOT NULL,
    `Units` INTEGER NOT NULL,
    `Amount` DECIMAL(15, 2) NOT NULL,
    `Delivery` VARCHAR(8) NOT NULL,
    `Recipient_name` VARCHAR(100) NOT NULL,
    `Sender_name` VARCHAR(100) NOT NULL,
    `Message` VARCHAR(1200) NULL,
    `Recipient_phone` VARCHAR(20) NULL,
    `Send_at` DATETIME(0) NULL,
    `Status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `Paid_at` DATETIME(0) NULL,
    `Sent_at` DATETIME(0) NULL,
    `Send_attempts` INTEGER NOT NULL DEFAULT 0,
    `Sms_provider_ID` VARCHAR(64) NULL,
    `Last_error` TEXT NULL,
    `Sender_notified_at` DATETIME(0) NULL,
    `Created` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `Last_updated` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `Giftcards_KID_key`(`KID`),
    INDEX `fk_Giftcards_to_Giftcard_products_idx`(`Product_ID`),
    INDEX `Giftcards_Status_Send_at_idx`(`Status`, `Send_at`),
    PRIMARY KEY (`ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- AddForeignKey
ALTER TABLE `Giftcard_products` ADD CONSTRAINT `fk_Giftcard_products_to_Organizations` FOREIGN KEY (`Organization_ID`) REFERENCES `Organizations`(`ID`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Giftcards` ADD CONSTRAINT `fk_Giftcards_to_Distributions` FOREIGN KEY (`KID`) REFERENCES `Distributions`(`KID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Giftcards` ADD CONSTRAINT `fk_Giftcards_to_Giftcard_products` FOREIGN KEY (`Product_ID`) REFERENCES `Giftcard_products`(`ID`) ON DELETE RESTRICT ON UPDATE CASCADE;
