-- A loan value that is unknown is NULL, never 0: a statement-detected loan
-- knows only its monthly debit, and 0 read as "paid off" / "0% interest".
ALTER TABLE `loans` MODIFY `original_amount` DECIMAL(12, 2) NULL,
    MODIFY `current_balance` DECIMAL(12, 2) NULL,
    MODIFY `annual_interest_rate` DECIMAL(5, 2) NULL;

-- Only statement loans carried 0 as "unknown"; a manual 0% loan is a real 0.
UPDATE `loans` SET `original_amount` = NULL WHERE `schedule_source` = 'statement' AND `original_amount` = 0;
UPDATE `loans` SET `current_balance` = NULL WHERE `schedule_source` = 'statement' AND `current_balance` = 0;
UPDATE `loans` SET `annual_interest_rate` = NULL WHERE `schedule_source` = 'statement' AND `annual_interest_rate` = 0;
UPDATE `loans` SET `original_amount_source` = 'unknown' WHERE `schedule_source` = 'statement' AND `original_amount` IS NULL;
