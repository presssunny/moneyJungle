-- Convert Settings.theme from an enum to a plain string so new themes
-- can be added without a schema migration each time.
ALTER TABLE `settings` MODIFY `theme` VARCHAR(30) NOT NULL DEFAULT 'neon-purple';
