-- AlterTable
ALTER TABLE `recurring_payments` ADD COLUMN `detected_key` VARCHAR(160) NULL,
    ADD COLUMN `detected_through` DATE NULL;

-- AlterTable
ALTER TABLE `loans` ADD COLUMN `detected_key` VARCHAR(160) NULL,
    ADD COLUMN `detected_through` DATE NULL;

-- CreateTable
CREATE TABLE `dismissed_commitments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `key` VARCHAR(160) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `dismissed_commitments_user_id_key_key`(`user_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `recurring_payments_user_id_detected_key_key` ON `recurring_payments`(`user_id`, `detected_key`);

-- CreateIndex
CREATE UNIQUE INDEX `loans_user_id_detected_key_key` ON `loans`(`user_id`, `detected_key`);

-- AddForeignKey
ALTER TABLE `dismissed_commitments` ADD CONSTRAINT `dismissed_commitments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
