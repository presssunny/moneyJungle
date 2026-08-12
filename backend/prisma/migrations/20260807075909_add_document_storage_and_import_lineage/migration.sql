-- Keep the uploaded bytes, and make an import undoable.
--
-- `documents.storage_path` is where the file itself now lives (relative to
-- DOCUMENT_STORAGE_DIR). Nullable because every document uploaded before this
-- migration has no stored file and must keep working.
--
-- `bank_transactions.statement_import_id` is the missing half of "which rows came
-- from which file". The credit side already had it (credit_transactions ->
-- credit_imports); the bank side had no link at all, so an import could only be
-- undone by guessing from the date range — and statements overlap freely, so that
-- guess would delete rows another file brought in. SET NULL, not CASCADE:
-- deleting a batch row must never silently take money rows with it.
--
-- Purely additive: three nullable columns, one index, one FK. No existing column
-- or index changes, and every current code path works unchanged.

-- AlterTable
ALTER TABLE `bank_transactions` ADD COLUMN `statement_import_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `documents` ADD COLUMN `linked_statement_import_id` INTEGER NULL,
    ADD COLUMN `storage_path` VARCHAR(500) NULL;

-- CreateIndex
CREATE INDEX `bank_transactions_statement_import_id_idx` ON `bank_transactions`(`statement_import_id`);

-- AddForeignKey
ALTER TABLE `bank_transactions` ADD CONSTRAINT `bank_transactions_statement_import_id_fkey` FOREIGN KEY (`statement_import_id`) REFERENCES `bank_statement_imports`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
