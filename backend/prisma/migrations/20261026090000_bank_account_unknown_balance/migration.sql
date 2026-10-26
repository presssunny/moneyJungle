-- A bank balance nobody stated is NULL, never 0: an account created without an
-- opening balance, and no statement or stated balance to measure from, has an
-- unknown balance — 0 there read as "the account is empty".
ALTER TABLE `bank_accounts` MODIFY `initial_balance` DECIMAL(12, 2) NULL,
    MODIFY `current_balance` DECIMAL(12, 2) NULL;

-- An opening 0 that no printed or stated balance confirms was the old default, not a fact.
UPDATE `bank_accounts` a SET a.`initial_balance` = NULL, a.`current_balance` = NULL
WHERE a.`initial_balance` = 0 AND a.`anchor_balance` IS NULL
  AND NOT EXISTS (SELECT 1 FROM `bank_statement_imports` s WHERE s.`bank_account_id` = a.`id` AND s.`closing_balance` IS NOT NULL);
