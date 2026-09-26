-- AlterTable
ALTER TABLE `savings_goals` ADD COLUMN `goal_type` ENUM('savings', 'purchase', 'debt_payoff') NOT NULL DEFAULT 'savings',
    ADD COLUMN `loan_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `savings_goals_loan_id_idx` ON `savings_goals`(`loan_id`);

-- AddForeignKey
ALTER TABLE `savings_goals` ADD CONSTRAINT `savings_goals_loan_id_fkey` FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
