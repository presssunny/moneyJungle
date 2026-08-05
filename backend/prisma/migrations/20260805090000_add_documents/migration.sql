-- Every file the user ever uploaded, and what came of it.
--
-- Records metadata only, never the bytes: `file_hash` already identifies a
-- re-upload of the same file and `coverage_from/to` identifies an overlapping
-- period, which is everything the app needs to answer "did I already import
-- this?". Storing the files themselves is a separate product decision (retention,
-- backup, deletion) and is deliberately not taken here.
--
-- Purely additive: no existing table or column changes, and the five existing
-- upload paths keep working whether or not they write a row here.
CREATE TABLE `documents` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_hash` VARCHAR(64) NOT NULL,
  `size_bytes` INTEGER NOT NULL DEFAULT 0,
  -- bank_statement | credit_report | loan_schedule | expense_sheet | unknown
  `kind` VARCHAR(30) NOT NULL,
  -- imported | rejected | superseded
  `status` VARCHAR(20) NOT NULL DEFAULT 'imported',
  `detected_bank` VARCHAR(120) NULL,
  `coverage_from` DATE NULL,
  `coverage_to` DATE NULL,
  `linked_loan_id` INTEGER NULL,
  `linked_account_id` INTEGER NULL,
  `linked_credit_import_id` INTEGER NULL,
  `rows_parsed` INTEGER NOT NULL DEFAULT 0,
  `rows_imported` INTEGER NOT NULL DEFAULT 0,
  `rows_skipped` INTEGER NOT NULL DEFAULT 0,
  -- The signals that decided the kind, so a wrong guess can be explained rather
  -- than argued with.
  `detection_json` TEXT NULL,
  `note` VARCHAR(255) NULL,
  `uploaded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `documents_user_id_uploaded_at_idx`(`user_id`, `uploaded_at`),
  INDEX `documents_user_id_file_hash_idx`(`user_id`, `file_hash`),
  INDEX `documents_user_id_kind_idx`(`user_id`, `kind`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `documents` ADD CONSTRAINT `documents_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
