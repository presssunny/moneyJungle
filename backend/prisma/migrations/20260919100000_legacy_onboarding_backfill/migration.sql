-- Users who already had financial activity before the onboarding flow
-- existed must not be forced through onboarding as if new, and must not be
-- silently treated as if they had reviewed a coverage summary they never saw.
-- They get an explicit `legacy` status instead.
--
-- Idempotent: both statements only touch rows that are still in their
-- untouched default state (`pending`, never reviewed, or no profile row at
-- all), so re-running this migration finds nothing left to change.

-- Existing profile rows that were auto-created (e.g. by a background read)
-- before the user ever started a real review.
UPDATE `financial_profiles` fp
SET fp.`onboarding` = 'legacy', fp.`updated_at` = CURRENT_TIMESTAMP(3)
WHERE fp.`onboarding` = 'pending'
  AND fp.`reviewed_at` IS NULL
  AND (
    EXISTS (SELECT 1 FROM `expenses` e WHERE e.`user_id` = fp.`user_id`)
    OR EXISTS (SELECT 1 FROM `incomes` i WHERE i.`user_id` = fp.`user_id`)
    OR EXISTS (SELECT 1 FROM `bank_transactions` bt WHERE bt.`user_id` = fp.`user_id`)
    OR EXISTS (SELECT 1 FROM `credit_transactions` ct WHERE ct.`user_id` = fp.`user_id`)
  );

-- Users with financial activity but no `financial_profiles` row at all yet
-- (profile rows are created lazily on first read).
INSERT INTO `financial_profiles` (`user_id`, `onboarding`, `updated_at`)
SELECT u.`id`, 'legacy', CURRENT_TIMESTAMP(3)
FROM `users` u
WHERE NOT EXISTS (SELECT 1 FROM `financial_profiles` fp WHERE fp.`user_id` = u.`id`)
  AND (
    EXISTS (SELECT 1 FROM `expenses` e WHERE e.`user_id` = u.`id`)
    OR EXISTS (SELECT 1 FROM `incomes` i WHERE i.`user_id` = u.`id`)
    OR EXISTS (SELECT 1 FROM `bank_transactions` bt WHERE bt.`user_id` = u.`id`)
    OR EXISTS (SELECT 1 FROM `credit_transactions` ct WHERE ct.`user_id` = u.`id`)
  );
