-- Say WHICH bank row closed a loan, not just that one did.
--
-- Undoing an import has to reopen the loans that import closed, and nothing else
-- can — three separate paths refuse to reopen a `finished` loan. Until now the
-- match was rebuilt afterwards from `closure_reason = 'early_repayment'` plus the
-- closing date and amount. Both halves fail: a hand closure defaults to the very
-- same reason, and one bank loan number can cover several tracks whose rows share
-- a number and a date, so the amount match was a guess presented as a fact.
--
-- `auto_closed_transaction_id` is written by the automatic path at the moment it
-- closes, when it already knows exactly which row matched. A manual closure never
-- writes it, which is the whole distinction. Plain INTEGER with no FK, following
-- documents.linked_*: the rollback deletes the row this points at and the loan
-- must survive that deletion.
--
-- Purely additive: one nullable column. Rows closed before this migration have
-- NULL and are reported for the user to check by hand, never reopened on a guess.

-- AlterTable
ALTER TABLE `loans` ADD COLUMN `auto_closed_transaction_id` INTEGER NULL;
