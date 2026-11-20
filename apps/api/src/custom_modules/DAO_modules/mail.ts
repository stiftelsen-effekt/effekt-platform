import { Mailersend_survey_responses } from "@prisma/client";
import { DAO } from "../DAO";

/**
 * How long an identical answer from the same donor counts as a repeat of the same submission.
 * MailerSend retries deliveries and re-sends earlier answers as donors move through a
 * multi-question survey; in production most repeats arrived within a minute and all within a day.
 * The same survey is embedded in later emails, so a genuine new answer days later is still kept.
 */
export const SURVEY_DUPLICATE_WINDOW_HOURS = 24;

export const mail = {
  /**
   * Saves one survey answer. With `skipRecentDuplicate`, the row is not written when the same
   * donor gave the identical answer to the same question within the duplicate window. The check
   * and the insert are one statement, so two concurrent retries cannot both see "no duplicate".
   *
   * @returns whether a row was written
   */
  saveMailerSendSurveyResponse: async (
    surveyResponse: Omit<Mailersend_survey_responses, "ID" | "timestamp">,
    { skipRecentDuplicate }: { skipRecentDuplicate: boolean } = { skipRecentDuplicate: true },
  ): Promise<boolean> => {
    const { surveyID, questionID, DonorID, answer, answerID } = surveyResponse;
    const [result] = await DAO.query(
      `
            INSERT INTO Mailersend_survey_responses (surveyID, questionID, DonorID, answer, answerID)
            SELECT ?, ?, ?, ?, ?
            FROM DUAL
            WHERE ? = 0 OR NOT EXISTS (
                SELECT 1 FROM Mailersend_survey_responses
                WHERE surveyID = ? AND questionID = ? AND DonorID = ?
                  AND answerID = ? AND answer = ?
                  AND timestamp > NOW() - INTERVAL ? HOUR
            )
            `,
      [
        surveyID,
        questionID,
        DonorID,
        answer,
        answerID,
        skipRecentDuplicate ? 1 : 0,
        surveyID,
        questionID,
        DonorID,
        answerID,
        answer,
        SURVEY_DUPLICATE_WINDOW_HOURS,
      ],
    );
    return (result as { affectedRows?: number }).affectedRows === 1;
  },
  getAllMailerSendSurveyResponses: async (): Promise<Record<string, any>[]> => {
    const [results] = await DAO.query(
      `SELECT * FROM EffektAnalysisDB.v_Mailersend_survey_responses_raw_enriched`,
    );
    return results;
  },
};
