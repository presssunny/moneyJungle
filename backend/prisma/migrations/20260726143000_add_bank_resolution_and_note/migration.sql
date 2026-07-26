-- Every imported bank row must end up somewhere. `reconcile_status` only said
-- whether a row had been dealt with; it never said *how*, so "done" covered both
-- "became an expense" and "was set aside", and "pending" covered both "waiting
-- for the user" and "the resolver has no rule for this". `resolution` records the
-- financial meaning of the row and `reconcile_note` states the reason in Hebrew,
-- so a row can never sit unaccounted for without saying why.
--
--   income                  → promoted to הכנסות
--   expense                 → promoted to הוצאות (ordinary spend)
--   financing_charge        → interest paid: expense, own category
--   financing_credit        → interest refunded: NEGATIVE financing expense, never income
--   debt_reduction          → loan principal: lowers debt, not spending
--   loan_repayment_unsplit  → combined loan payment with no principal/interest split in the statement
--   loan_drawdown           → loan received: a liability, not income
--   credit_card_settled     → card bill already itemized in the credit module (excluded, no double count)
--   credit_card_unitemized  → card bill with no matching credit import: real spend, counted here
--   internal_transfer       → money moved between own accounts, both legs held out
--   manual_excluded         → the user set this row aside by hand; the resolver never touches it again
ALTER TABLE `bank_transactions`
  ADD COLUMN `resolution` VARCHAR(30) NULL,
  ADD COLUMN `reconcile_note` VARCHAR(255) NULL;

CREATE INDEX `bank_transactions_user_id_resolution_idx`
  ON `bank_transactions`(`user_id`, `resolution`);
