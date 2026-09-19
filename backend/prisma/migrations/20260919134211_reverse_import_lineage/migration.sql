-- AlterTable
ALTER TABLE `bank_transactions` ADD COLUMN `import_row_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `credit_transactions` ADD COLUMN `import_row_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `expenses` ADD COLUMN `import_row_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `bank_transactions_import_row_id_idx` ON `bank_transactions`(`import_row_id`);

-- CreateIndex
CREATE INDEX `credit_transactions_import_row_id_idx` ON `credit_transactions`(`import_row_id`);

-- CreateIndex
CREATE INDEX `expenses_import_row_id_idx` ON `expenses`(`import_row_id`);

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_import_row_id_fkey` FOREIGN KEY (`import_row_id`) REFERENCES `import_rows`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `credit_transactions` ADD CONSTRAINT `credit_transactions_import_row_id_fkey` FOREIGN KEY (`import_row_id`) REFERENCES `import_rows`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_transactions` ADD CONSTRAINT `bank_transactions_import_row_id_fkey` FOREIGN KEY (`import_row_id`) REFERENCES `import_rows`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
