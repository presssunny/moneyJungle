/*
  Warnings:

  - Added the required column `billing_date` to the `credit_transactions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `credit_transactions` ADD COLUMN `billing_date` DATE NOT NULL,
    ADD COLUMN `charge_date` DATE NULL,
    ADD COLUMN `transaction_type` VARCHAR(30) NOT NULL DEFAULT 'regular';

-- CreateIndex
CREATE INDEX `credit_transactions_user_id_billing_date_idx` ON `credit_transactions`(`user_id`, `billing_date`);
