CREATE TABLE `credit_cards` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `issuer` VARCHAR(80) NOT NULL,
  `last_four` VARCHAR(4) NOT NULL,
  `billing_day` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `credit_cards_user_id_idx` (`user_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `credit_cards_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `credit_transactions` ADD COLUMN `card_id` INTEGER NULL;
CREATE INDEX `credit_transactions_card_id_idx` ON `credit_transactions` (`card_id`);
ALTER TABLE `credit_transactions` ADD CONSTRAINT `credit_transactions_card_id_fkey` FOREIGN KEY (`card_id`) REFERENCES `credit_cards` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
