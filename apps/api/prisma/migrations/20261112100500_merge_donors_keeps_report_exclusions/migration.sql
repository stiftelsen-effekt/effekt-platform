-- merge_donors as in 20261112095000_merge_donors_keeps_notices, plus: when tax units with the
-- same number are consolidated, the Tax_report_exclusions of the units merged away (tax units an
-- admin left out of a year's report) move to the kept unit instead of cascading away, so a number
-- left out stays out. One per unit and year: a year the kept unit already has stays as it is.
-- (No INSERT IGNORE: the procedure rolls back on any warning.)
DROP PROCEDURE IF EXISTS `merge_donors`;

CREATE PROCEDURE `merge_donors`(IN sourceDonorId INT, IN destinationDonorId INT) BEGIN
	DECLARE finished INTEGER DEFAULT 0;
	DECLARE currentSsn varchar(11) DEFAULT "";
    DECLARE selectedTaxUnitId INT;

	# Get all tax units grouped by ssn
    # Used after the donor is merged
	DECLARE curSsns CURSOR FOR SELECT ssn FROM Tax_unit WHERE Donor_ID = destinationDonorId GROUP BY ssn HAVING COUNT(ssn)>1;

	DECLARE exit handler for sqlexception
	BEGIN
		ROLLBACK;
        RESIGNAL;
	END;

	DECLARE exit handler for sqlwarning
	BEGIN
		ROLLBACK;
        RESIGNAL;
    END;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET finished = 1;

    # Merging a donor into itself would fall through to the DELETE below and
    # take the donor and everything cascading off them with it
    IF sourceDonorId = destinationDonorId THEN
		SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'merge_donors: source and destination donor must differ';
	END IF;

    # Start merging donor
    START TRANSACTION;

    UPDATE Distributions SET Donor_ID = destinationDonorId WHERE Donor_ID = sourceDonorId;
    UPDATE Donations SET Donor_ID = destinationDonorId WHERE Donor_ID = sourceDonorId AND ID > -1;
    UPDATE Vipps_agreements SET donorID = destinationDonorId WHERE donorID = sourceDonorId AND ID != 'abc';
    UPDATE Vipps_orders SET donorID = destinationDonorId WHERE donorID = sourceDonorId AND ID > -1;
    UPDATE Paypal_historic_distributions SET Donor_ID = destinationDonorId WHERE Donor_ID = sourceDonorId AND ID > -1;
    UPDATE Referral_records SET DonorID = destinationDonorId WHERE DonorID = sourceDonorId AND ID > -1;
    UPDATE FB_payment_ID SET donorID = destinationDonorId WHERE donorID = sourceDonorId AND ID > -1;
    UPDATE Tax_unit SET Donor_ID = destinationDonorId WHERE Donor_ID = sourceDonorId AND ID > -1;
    # Transfer fundraiser ownership before deleting source donor to prevent cascade delete
    UPDATE Fundraisers SET Donor_ID = destinationDonorId WHERE Donor_ID = sourceDonorId AND ID > -1;
    # Cascade deletes - these rows are destroyed with the source donor if not moved
    UPDATE Swish_orders SET donorID = destinationDonorId WHERE donorID = sourceDonorId AND ID > -1;
    UPDATE Mailersend_survey_responses SET DonorID = destinationDonorId WHERE DonorID = sourceDonorId AND ID > -1;
    # Set null on delete - these rows survive but lose the donor reference
    UPDATE Adoveo_fundraiser SET Donor_ID = destinationDonorId WHERE Donor_ID = sourceDonorId AND ID > -1;
    UPDATE Adoveo_giftcard_transactions SET Sender_donor_ID = destinationDonorId WHERE Sender_donor_ID = sourceDonorId AND ID > -1;
    UPDATE Adoveo_giftcard_transactions SET Receiver_donor_ID = destinationDonorId WHERE Receiver_donor_ID = sourceDonorId AND ID > -1;

    # Missing tax unit notices: where the destination has a row for the year, the source's
    # "sent" wins over the destination's "excluded", and reminders are kept
    # (separate statements: a multi-table UPDATE doesn't promise the order of its assignments)
    UPDATE Tax_unit_notices dest
        JOIN Tax_unit_notices src ON src.Donor_ID = sourceDonorId AND src.Year = dest.Year
    SET dest.Status = 'sent', dest.Updated_by = src.Updated_by, dest.Updated = src.Updated
    WHERE dest.Donor_ID = destinationDonorId AND src.Status = 'sent' AND dest.Status <> 'sent'
        AND dest.ID > -1;
    UPDATE Tax_unit_notices dest
        JOIN Tax_unit_notices src ON src.Donor_ID = sourceDonorId AND src.Year = dest.Year
    SET dest.Last_reminded = src.Last_reminded, dest.Last_reminded_by = src.Last_reminded_by
    WHERE dest.Donor_ID = destinationDonorId AND src.Last_reminded IS NOT NULL
        AND (dest.Last_reminded IS NULL OR src.Last_reminded > dest.Last_reminded) AND dest.ID > -1;
    UPDATE Tax_unit_notices dest
        JOIN Tax_unit_notices src ON src.Donor_ID = sourceDonorId AND src.Year = dest.Year
    SET dest.Reminders = src.Reminders
    WHERE dest.Donor_ID = destinationDonorId AND src.Reminders > dest.Reminders AND dest.ID > -1;
    # The rest (years the destination has no row for) move over; the clashing ones are left on
    # the source and cascade away with it below
    UPDATE Tax_unit_notices src
        LEFT JOIN Tax_unit_notices dest ON dest.Donor_ID = destinationDonorId AND dest.Year = src.Year
    SET src.Donor_ID = destinationDonorId
    WHERE src.Donor_ID = sourceDonorId AND dest.ID IS NULL AND src.ID > -1;

    DELETE FROM Donors WHERE ID = sourceDonorId;

    # Loop over all where count of ssn > 1
    OPEN curSsns;
	consolidateTaxUnits: LOOP
		FETCH curSsns INTO currentSsn;
		IF finished = 1 THEN
			LEAVE consolidateTaxUnits;
		END IF;

		# Keep the active unit with the lowest ID (an archived one only if all are archived)
		SELECT ID FROM Tax_unit WHERE Donor_ID = destinationDonorId AND ssn = currentSsn
			ORDER BY archived IS NOT NULL, ID LIMIT 1 INTO selectedTaxUnitId;
		UPDATE FB_payment_ID
			SET taxUnitID = selectedTaxUnitId
			WHERE
				donorID = destinationDonorId AND
				taxUnitID IN (SELECT * FROM (SELECT ID FROM Tax_unit WHERE Donor_ID = destinationDonorId AND ssn = currentSsn) as fbIds) AND
				ID > -1;
        UPDATE Distributions
			SET Tax_unit_ID = selectedTaxUnitId
            WHERE
				Donor_ID = destinationDonorId AND
                Tax_unit_ID IN (SELECT * FROM (SELECT ID FROM Tax_unit WHERE Donor_ID = destinationDonorId AND ssn = currentSsn) as ids);

        INSERT INTO Tax_report_exclusions (Tax_unit_ID, Year, Reason, Created_by, Created)
			SELECT selectedTaxUnitId, e.Year, ANY_VALUE(e.Reason), ANY_VALUE(e.Created_by), MIN(e.Created)
			FROM Tax_report_exclusions e
			WHERE
				e.Tax_unit_ID IN (SELECT ID FROM Tax_unit WHERE Donor_ID = destinationDonorId AND ssn = currentSsn AND ID <> selectedTaxUnitId) AND
				NOT EXISTS (SELECT 1 FROM Tax_report_exclusions k WHERE k.Tax_unit_ID = selectedTaxUnitId AND k.Year = e.Year)
			GROUP BY e.Year;

        DELETE FROM Tax_unit
			WHERE
				Donor_ID = destinationDonorId AND
				ssn = currentSsn AND
                ID != selectedTaxUnitId;
    END LOOP consolidateTaxUnits;

    CLOSE curSsns;

    COMMIT;
END;
