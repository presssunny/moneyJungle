-- AlterTable
ALTER TABLE `incomes` ADD COLUMN `source` ENUM('manual', 'bank_import') NOT NULL DEFAULT 'manual';

-- Backfill: every income a bank row still points to was created from that statement.
UPDATE `incomes` SET `source` = 'bank_import'
WHERE `id` IN (SELECT `linked_income_id` FROM `bank_transactions` WHERE `linked_income_id` IS NOT NULL);
