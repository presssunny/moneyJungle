-- Multi-user authentication, RBAC, and the FamilyMember split.
--
-- What this does, in order:
--   1. Clears `gate_sessions` — the ONLY destructive statement here, and
--      deliberate: the old session model recorded no owning user (every
--      session was implicitly "the primary user" — see the removed
--      getPrimaryUserId() in gateAuth.middleware.ts), so an existing session
--      row cannot be backfilled with a real user_id. There is nothing to
--      preserve: a session is a login token, not user data, and its only
--      effect is that whoever is currently logged in has to log in again
--      once. No account, and no financial/household data, is touched here.
--   2. Adds `user_id` to `gate_sessions` (now safe to make NOT NULL, since
--      the table is empty) so a session identifies a specific account.
--   3. Adds `email` / `password_hash` / `role` / `status` to `users`. The
--      first two are nullable — existing accounts (today: exactly one, the
--      household created before this migration) have no password to
--      migrate; see backend/prisma/scripts/backfillMultiUserAuth.ts, which
--      you run once, manually, after this migration, to give that account
--      real login credentials. `role` defaults to USER and `status` to
--      active for every existing row — the backfill script promotes the
--      specific account it provisions to ADMIN.
--   4. Creates `family_members` — see the model's doc comment in
--      schema.prisma for why this is a new table rather than reusing
--      `users`. Starts empty; nothing existing moves into it automatically
--      (today's database has no extra `users` rows to move — see the
--      migration notes in the final report for what to do if that is ever
--      not true before you run this).

-- Sessions carry no owning user under the old model — cleared, not migrated.
DELETE FROM `gate_sessions`;

-- AlterTable
ALTER TABLE `gate_sessions` ADD COLUMN `user_id` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `email` VARCHAR(255) NULL,
    ADD COLUMN `password_hash` VARCHAR(255) NULL,
    ADD COLUMN `role` ENUM('ADMIN', 'USER', 'VIEWER') NOT NULL DEFAULT 'USER',
    ADD COLUMN `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE `family_members` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `relation` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `family_members_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `gate_sessions_user_id_idx` ON `gate_sessions`(`user_id`);

-- CreateIndex
CREATE UNIQUE INDEX `users_email_key` ON `users`(`email`);

-- AddForeignKey
ALTER TABLE `family_members` ADD CONSTRAINT `family_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gate_sessions` ADD CONSTRAINT `gate_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
