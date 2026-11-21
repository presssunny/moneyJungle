-- What the bank's own pages showed (CLAUDE.md §7 A2). Labels and fill-ins only:
-- a standing order's amount and dates stay the checking debit's.
ALTER TABLE `recurring_payments` ADD COLUMN `verified_at` DATE NULL,
    ADD COLUMN `verified_source` VARCHAR(20) NULL,
    ADD COLUMN `debit_kind` VARCHAR(20) NULL,
    ADD COLUMN `bank_status` VARCHAR(10) NULL,
    ADD COLUMN `bank_reference` VARCHAR(4) NULL;

-- The day of the bank-site figures a loan snapshot filled in; only a later snapshot may replace them.
ALTER TABLE `loans` ADD COLUMN `site_snapshot_as_of` DATE NULL;
