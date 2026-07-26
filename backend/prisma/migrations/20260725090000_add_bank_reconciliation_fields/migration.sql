-- Persist bank-line classification + reconciliation state so imported bank data
-- can be surfaced into the right tabs (incomes / loans / expenses) without
-- copying rows blindly (double-count safe: credit-card-payment lines are marked
-- and excluded, since they are already itemized in the credit module).
ALTER TABLE `bank_transactions`
  ADD COLUMN `line_kind` VARCHAR(30) NOT NULL DEFAULT 'standard',
  ADD COLUMN `loan_ref` VARCHAR(20) NULL,
  ADD COLUMN `reconcile_status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN `linked_income_id` INT NULL,
  ADD COLUMN `linked_loan_id` INT NULL,
  ADD COLUMN `linked_expense_id` INT NULL;

CREATE INDEX `bank_transactions_user_id_reconcile_status_idx`
  ON `bank_transactions`(`user_id`, `reconcile_status`);
