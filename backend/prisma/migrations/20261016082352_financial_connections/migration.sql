-- CreateTable
CREATE TABLE `financial_connections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `provider` VARCHAR(30) NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `bank_account_id` INTEGER NULL,
    `account_hint` VARCHAR(20) NULL,
    `credentials` TEXT NOT NULL,
    `verified_at` DATETIME(3) NULL,
    `last_sync_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `financial_connections_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `connection_syncs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `connection_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `error_type` VARCHAR(40) NULL,
    `message` VARCHAR(500) NULL,
    `outcome` JSON NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    INDEX `connection_syncs_connection_id_started_at_idx`(`connection_id`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `financial_connections` ADD CONSTRAINT `financial_connections_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `financial_connections` ADD CONSTRAINT `financial_connections_bank_account_id_fkey` FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `connection_syncs` ADD CONSTRAINT `connection_syncs_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `financial_connections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
