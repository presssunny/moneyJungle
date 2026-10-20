-- AlterTable
ALTER TABLE `connection_syncs` ADD COLUMN `cancel_requested_at` DATETIME(3) NULL,
    ADD COLUMN `deadline_at` DATETIME(3) NULL,
    ADD COLUMN `method` VARCHAR(16) NOT NULL DEFAULT 'password',
    ADD COLUMN `owner_pid` INTEGER NULL,
    ADD COLUMN `phase` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `financial_connections` ADD COLUMN `blocked_reason` VARCHAR(40) NULL,
    ADD COLUMN `login_method` VARCHAR(16) NOT NULL DEFAULT 'password',
    ADD COLUMN `sync_locked_at` DATETIME(3) NULL,
    MODIFY `credentials` TEXT NULL;

-- "awaiting_approval" was inferred from LOGGING_IN, not observed; it becomes a phase of a running sync.
UPDATE `connection_syncs` SET `status` = 'running', `phase` = 'awaiting_bank' WHERE `status` = 'awaiting_approval';
