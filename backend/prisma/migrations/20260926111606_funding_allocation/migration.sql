-- AlterTable
ALTER TABLE `financial_profiles` ADD COLUMN `saved_reserve_location` VARCHAR(12) NULL,
    ADD COLUMN `spending_account_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `funding_assignments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `source_key` VARCHAR(40) NOT NULL,
    `bank_account_id` INTEGER NOT NULL,
    `confirmed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `funding_assignments_bank_account_id_idx`(`bank_account_id`),
    UNIQUE INDEX `funding_assignments_user_id_source_key_key`(`user_id`, `source_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `financial_profiles` ADD CONSTRAINT `financial_profiles_spending_account_id_fkey` FOREIGN KEY (`spending_account_id`) REFERENCES `bank_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `funding_assignments` ADD CONSTRAINT `funding_assignments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `funding_assignments` ADD CONSTRAINT `funding_assignments_bank_account_id_fkey` FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
