/**
 * What ops can do with a gift card before (or after a failed) send: retry the SMS, move its send
 * time, or cancel it. Each is confirmed; errors (e.g. the sender claimed it meanwhile) stay in
 * the dialog.
 */
import { BanIcon, CalendarClockIcon, RotateCwIcon } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { DateTime, Money } from "@/components/domain/format";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { giftcardActions, parseSendAt, toSendAtInputs, type Giftcard } from "./model";

const subject = (giftcard: Giftcard) => `the gift card to ${giftcard.recipientName}`;

export function GiftcardActions({
  giftcard,
  onRetry,
  onReschedule,
  onCancel,
}: {
  giftcard: Giftcard;
  onRetry: () => Promise<unknown>;
  onReschedule: (sendAt: string) => Promise<unknown>;
  onCancel: () => Promise<unknown>;
}) {
  const allowed = giftcardActions(giftcard);
  if (!allowed.retry && !allowed.reschedule && !allowed.cancel) return null;
  return (
    <>
      {allowed.retry && (
        <ConfirmDialog
          trigger={
            <Button>
              <RotateCwIcon />
              Retry SMS…
            </Button>
          }
          title={`Send the SMS to ${giftcard.recipientName} again?`}
          consequences={[
            "The next scheduled run (every few minutes) sends it, up to 3 attempts.",
            giftcard.lastError && <>Last error: {giftcard.lastError}</>,
          ].filter(Boolean)}
          confirmLabel="Retry SMS"
          onConfirm={onRetry}
        />
      )}
      {allowed.reschedule && <RescheduleDialog giftcard={giftcard} onConfirm={onReschedule} />}
      {allowed.cancel && (
        <ConfirmDialog
          tone="danger"
          trigger={
            <Button>
              <BanIcon />
              Cancel gift card…
            </Button>
          }
          title={`Cancel ${subject(giftcard)}?`}
          consequences={[
            giftcard.delivery === "sms"
              ? "The SMS is never sent, and the recipient's page stops showing the gift."
              : "The recipient's page stops showing the gift.",
            giftcard.status === "pending" ? (
              "No payment has come in. If it does, the donation is kept, but the gift card stays cancelled."
            ) : (
              <>
                The donation of <Money value={giftcard.amount} className="font-semibold" /> is kept;
                refund it separately if the buyer asks.
              </>
            ),
            "This can't be undone here.",
          ]}
          confirmLabel="Cancel gift card"
          onConfirm={onCancel}
        />
      )}
    </>
  );
}

function RescheduleDialog({
  giftcard,
  onConfirm,
}: {
  giftcard: Giftcard;
  onConfirm: (sendAt: string) => Promise<unknown>;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("16:00");
  const parsed = parseSendAt(date, time);
  const touched = date !== "";
  return (
    <ConfirmDialog
      onOpenChange={(open) => {
        if (!open) return;
        const current = toSendAtInputs(giftcard.sendAt);
        setDate(current.date);
        setTime(current.time);
      }}
      trigger={
        <Button>
          <CalendarClockIcon />
          Reschedule…
        </Button>
      }
      title={`Change when the SMS to ${giftcard.recipientName} is sent?`}
      consequences={[
        <span key="before">
          <span className="text-muted-foreground">Now:</span>{" "}
          {giftcard.sendAt ? <DateTime value={giftcard.sendAt} format="datetime" /> : "–"}
          {" → "}
          <strong className="font-semibold">
            {"sendAt" in parsed ? <DateTime value={parsed.sendAt} format="datetime" /> : "…"}
          </strong>
        </span>,
        "Oslo time. The buyer isn't told about the change.",
      ]}
      confirmLabel="Reschedule"
      disabled={!("sendAt" in parsed)}
      onConfirm={() => ("sendAt" in parsed ? onConfirm(parsed.sendAt) : undefined)}
    >
      <div className="grid grid-cols-[1fr_8rem] gap-3">
        <Field
          label="Send date"
          error={touched && "error" in parsed ? parsed.error : undefined}
          required
        >
          <DateInput value={date} onValueChange={setDate} />
        </Field>
        <Field label="Time">
          <Input
            type="time"
            value={time}
            className="num"
            onChange={(event) => setTime(event.target.value)}
          />
        </Field>
      </div>
    </ConfirmDialog>
  );
}
