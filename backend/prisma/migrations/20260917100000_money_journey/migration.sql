-- CreateTable
CREATE TABLE `import_sessions` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `file_hash` VARCHAR(64) NOT NULL,
    `storage_path` VARCHAR(500) NOT NULL,
    `kind` VARCHAR(30) NOT NULL DEFAULT 'unknown',
    `status` VARCHAR(30) NOT NULL DEFAULT 'needs_input',
    `version` INTEGER NOT NULL DEFAULT 0,
    `answers` JSON NULL,
    `preview` JSON NULL,
    `result` JSON NULL,
    `error` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `import_sessions_user_id_file_hash_idx`(`user_id`, `file_hash`),
    INDEX `import_sessions_user_id_status_idx`(`user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `financial_profiles` (
    `user_id` INTEGER NOT NULL,
    `onboarding` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `scope` JSON NULL,
    `coverage` JSON NULL,
    `cash_buffer` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `essential_reserve` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `saved_reserve` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `reviewed_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `commitment_decisions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `event_key` VARCHAR(160) NOT NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `decision` VARCHAR(20) NOT NULL,
    `note` VARCHAR(255) NOT NULL,
    `bank_transaction_id` INTEGER NULL,
    `related_event_key` VARCHAR(160) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `commitment_decisions_user_id_event_key_key`(`user_id`, `event_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `money_check_ins` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `step` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `snapshot` JSON NULL,
    `action` JSON NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `money_check_ins_user_id_status_completed_at_idx`(`user_id`, `status`, `completed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `import_sessions` ADD CONSTRAINT `import_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `financial_profiles` ADD CONSTRAINT `financial_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commitment_decisions` ADD CONSTRAINT `commitment_decisions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `money_check_ins` ADD CONSTRAINT `money_check_ins_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing users' welcome completion once, without trusting a writable
-- notifications JSON flag for future accounts.
INSERT INTO financial_profiles (user_id, onboarding, cash_buffer, essential_reserve, saved_reserve, updated_at)
SELECT user_id, 'legacy', 0, 0, 0, CURRENT_TIMESTAMP(3)
FROM settings WHERE JSON_EXTRACT(notifications_json, '$.onboardingCompleted') = true;
