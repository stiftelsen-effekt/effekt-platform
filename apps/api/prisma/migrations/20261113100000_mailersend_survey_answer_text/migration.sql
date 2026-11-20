-- MailerSend surveys now include a free-text question, and answers were capped at
-- VARCHAR(191). In strict mode a longer reply fails the INSERT and the webhook returns
-- a 500 for the whole submission. TEXT holds up to 64 KB. In-place widening, no data change.

-- AlterTable
ALTER TABLE `Mailersend_survey_responses` MODIFY `answer` TEXT NOT NULL;
