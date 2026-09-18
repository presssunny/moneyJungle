ALTER TABLE `import_sessions` ADD COLUMN `parser_version` VARCHAR(30) NOT NULL DEFAULT 'journey-v2';
CREATE TABLE `import_rows` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `session_id` VARCHAR(36) NOT NULL,
  `row_number` INTEGER NOT NULL,
  `original` JSON NOT NULL,
  `normalized` JSON NOT NULL,
  `candidates` JSON NOT NULL,
  `resolution` VARCHAR(20) NOT NULL DEFAULT 'include',
  `match_ref` JSON NULL,
  `output_ref` JSON NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `import_rows_session_id_row_number_key` (`session_id`, `row_number`),
  CONSTRAINT `import_rows_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `import_sessions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
