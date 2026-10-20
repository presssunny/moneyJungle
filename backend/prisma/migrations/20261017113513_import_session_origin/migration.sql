-- AlterTable
ALTER TABLE `import_sessions` ADD COLUMN `origin` VARCHAR(10) NOT NULL DEFAULT 'file';
