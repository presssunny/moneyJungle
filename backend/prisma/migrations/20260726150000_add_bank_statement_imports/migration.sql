-- Track the period each bank statement covers and the balance the bank printed,
-- so the account balance can be derived instead of accumulated per import.
CREATE TABLE `bank_statement_imports` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `bank_account_id` INTEGER NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_hash` VARCHAR(64) NOT NULL,
  `coverage_from` DATE NOT NULL,
  `coverage_to` DATE NOT NULL,
  `opening_balance` DECIMAL(12,2) NULL,
  `closing_balance` DECIMAL(12,2) NULL,
  `parsed_rows` INTEGER NOT NULL DEFAULT 0,
  `imported_rows` INTEGER NOT NULL DEFAULT 0,
  `skipped_duplicates` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `bank_statement_imports_user_account_coverage_idx`(`user_id`, `bank_account_id`, `coverage_to`),
  INDEX `bank_statement_imports_user_id_file_hash_idx`(`user_id`, `file_hash`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bank_statement_imports` ADD CONSTRAINT `bank_statement_imports_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `bank_statement_imports` ADD CONSTRAINT `bank_statement_imports_bank_account_id_fkey`
  FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
