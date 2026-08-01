-- Loans gain their bank identity, a closure record and the counters a real
-- amortisation schedule supplies. Every column is additive and nullable, so no
-- existing row changes meaning and no existing figure moves.
--
-- Deliberately NOT added: a parent-loan column. Loan 108 is two tracks (432 and
-- 562); modelling an aggregate parent row would make it a `loans` record too, and
-- the five modules that sum `findActive()` — dashboard, insights, alerts, updates,
-- cashflow — would double-count every shekel. Tracks are grouped by `loan_number`
-- in the UI instead, which costs nothing and cannot corrupt a total.
ALTER TABLE `loans`
  ADD COLUMN `loan_number` VARCHAR(30) NULL,
  ADD COLUMN `track_number` VARCHAR(30) NULL,
  ADD COLUMN `track_name` VARCHAR(120) NULL,
  ADD COLUMN `closed_at` DATE NULL,
  ADD COLUMN `closure_reason` VARCHAR(30) NULL,
  ADD COLUMN `closure_cost` DECIMAL(12,2) NULL,
  ADD COLUMN `total_payments` INTEGER NULL,
  ADD COLUMN `payments_made` INTEGER NULL,
  ADD COLUMN `schedule_source` VARCHAR(20) NOT NULL DEFAULT 'computed',
  ADD COLUMN `original_amount_source` VARCHAR(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN `schedule_imported_at` DATETIME(3) NULL;

-- Re-uploading a schedule for the same loan must update it, never duplicate it.
CREATE INDEX `loans_user_id_loan_number_track_number_idx`
  ON `loans`(`user_id`, `loan_number`, `track_number`);

-- The bank's own amortisation table, one row per payment. This is the loan's
-- source of truth for its terms; the bank statement stays the source of truth for
-- what actually happened (an early repayment the schedule cannot know about).
CREATE TABLE `loan_schedule_entries` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `loan_id` INTEGER NOT NULL,
  `payment_number` INTEGER NOT NULL,
  `payment_date` DATE NOT NULL,
  `principal` DECIMAL(12,2) NOT NULL,
  `interest` DECIMAL(12,2) NOT NULL,
  `total` DECIMAL(12,2) NOT NULL,
  `balance_after` DECIMAL(12,2) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `loan_schedule_entries_loan_id_payment_number_key`(`loan_id`, `payment_number`),
  INDEX `loan_schedule_entries_loan_id_payment_date_idx`(`loan_id`, `payment_date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `loan_schedule_entries` ADD CONSTRAINT `loan_schedule_entries_loan_id_fkey`
  FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
