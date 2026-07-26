-- Identify a re-uploaded credit statement by its content, not its file name.
ALTER TABLE `credit_imports` ADD COLUMN `file_hash` VARCHAR(64) NULL;
CREATE INDEX `credit_imports_user_id_file_hash_idx` ON `credit_imports`(`user_id`, `file_hash`);
