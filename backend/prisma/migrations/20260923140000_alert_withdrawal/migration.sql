ALTER TABLE `alerts`
  ADD COLUMN `evidence_key` VARCHAR(64) NULL,
  ADD COLUMN `withdrawn_at` DATETIME(3) NULL,
  ADD INDEX `alerts_user_id_type_withdrawn_at_idx` (`user_id`, `type`, `withdrawn_at`);
