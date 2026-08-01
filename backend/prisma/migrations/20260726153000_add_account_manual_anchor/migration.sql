-- A balance the user states directly from the bank, for statements that carry
-- no printed balance column. Anchors the account the same way a statement does.
ALTER TABLE `bank_accounts` ADD COLUMN `anchor_balance` DECIMAL(12,2) NULL;
ALTER TABLE `bank_accounts` ADD COLUMN `anchor_date` DATE NULL;
