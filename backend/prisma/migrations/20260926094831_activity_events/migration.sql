-- CreateTable
CREATE TABLE `activity_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `domain` VARCHAR(40) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `entity_id` VARCHAR(64) NULL,
    `summary` VARCHAR(300) NOT NULL,
    `route` VARCHAR(160) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `activity_events_user_id_created_at_id_idx`(`user_id`, `created_at`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `activity_events` ADD CONSTRAINT `activity_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
