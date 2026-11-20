import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlagIcon, FlagOffIcon } from "lucide-react";
import { useState } from "react";
import { Callout } from "@/components/domain/callout";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { describeError } from "@/components/domain/error-state";
import { Money } from "@/components/domain/format";
import { useDiscardGuard } from "@/components/domain/unsaved-changes";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { invalidateDonationQueries } from "@/features/donations/invalidate";
import { formatAmount } from "@/features/donations/edit-model";
import { notify } from "@/lib/notify";
import { strings } from "@/lib/strings";
import { errorCode, useTRPC } from "@/lib/trpc";

type Donation = { id: number; sum: string; donorId: number };

/** Fundraiser_transactions.Message_sender_name is VARCHAR(45) */
const MAX_NAME = 45;

/** A fundraiser ID as typed, or null while it isn't one. */
export function parseFundraiserId(value: string): number | null {
  const trimmed = value.trim().replace(/^#/, "");
  if (!/^\d+$/.test(trimmed)) return null;
  const id = Number(trimmed);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function useInvalidate(donation: Donation) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      invalidateDonationQueries(queryClient, trpc, [donation.donorId]),
      queryClient.invalidateQueries({ queryKey: trpc.reports.fundraisers.pathKey() }),
    ]);
}

/**
 * Counts a donation towards a fundraiser, with the message and name a gift through the
 * fundraiser page would have.
 */
export function AddToFundraiserDialog({ donation }: { donation: Donation }) {
  const trpc = useTRPC();
  const invalidate = useInvalidate(donation);
  const [open, setOpen] = useState(false);
  const [fundraiserText, setFundraiserText] = useState("");
  const [message, setMessage] = useState("");
  const [senderName, setSenderName] = useState("");
  const [showName, setShowName] = useState(true);
  const [touched, setTouched] = useState(false);

  const fundraiserId = parseFundraiserId(fundraiserText);
  const fundraiser = useQuery({
    ...trpc.reports.fundraisers.get.queryOptions({ id: fundraiserId ?? 0 }),
    enabled: open && fundraiserId !== null,
    retry: false,
  });
  const owner = useQuery({
    ...trpc.donors.get.queryOptions({ donorId: fundraiser.data?.donorId ?? 0 }),
    enabled: open && fundraiser.data !== undefined,
  });

  const attach = useMutation(trpc.reports.fundraisers.attachDonation.mutationOptions());
  const dirty = fundraiserText.trim() !== "" || message.trim() !== "" || senderName.trim() !== "";
  const guard = useDiscardGuard(dirty, () => setOpen(false));

  function onOpenChange(next: boolean) {
    if (attach.isPending) return;
    if (!next) return guard.requestClose();
    setOpen(true);
    setFundraiserText("");
    setMessage("");
    setSenderName("");
    setShowName(true);
    setTouched(false);
    attach.reset();
  }

  const notFound = fundraiser.isError && errorCode(fundraiser.error) === "NOT_FOUND";
  const fundraiserError = !touched
    ? undefined
    : fundraiserId === null
      ? "Enter the fundraiser's ID, e.g. 123"
      : notFound
        ? `There is no fundraiser #${fundraiserId}`
        : undefined;

  async function submit() {
    setTouched(true);
    if (fundraiserId === null || notFound) return;
    try {
      await attach.mutateAsync({
        donationId: donation.id,
        fundraiserId,
        message: message.trim(),
        messageSenderName: senderName.trim() || null,
        showName,
      });
      await invalidate();
      setOpen(false);
      notify.success(
        "Added to fundraiser",
        `#${donation.id} · ${formatAmount(donation.sum)} → fundraiser #${fundraiserId}`,
      );
    } catch {
      // shown in the dialog
    }
  }

  const error = attach.error ? describeError(attach.error) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <FlagIcon />
          Add to fundraiser…
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add donation #{donation.id} to a fundraiser?</DialogTitle>
          <DialogDescription>
            The donation of {formatAmount(donation.sum)} counts towards the fundraiser's total and
            shows in its list of gifts. It gets a KID of its own with the same donor, tax unit and
            split; other donations on its current KID are not moved.
          </DialogDescription>
        </DialogHeader>
        <form
          id={`attach-fundraiser-${donation.id}`}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label="Fundraiser ID" required error={fundraiserError}>
            <Input
              inputMode="numeric"
              autoComplete="off"
              placeholder="123"
              value={fundraiserText}
              onChange={(event) => setFundraiserText(event.target.value)}
            />
          </Field>
          {fundraiser.data && (
            <p className="text-sm text-muted-foreground" data-testid="fundraiser-preview">
              Fundraiser #{fundraiser.data.id}
              {owner.data && <> run by {owner.data.name}</>} · {fundraiser.data.donationCount}{" "}
              donations · <Money value={fundraiser.data.totalSum} />
            </p>
          )}
          <Field label="Message" hint="Optional. Shown with the gift on the fundraiser page.">
            <Textarea
              value={message}
              maxLength={2000}
              onChange={(event) => setMessage(event.target.value)}
            />
          </Field>
          <Field label="Name" hint="Optional. Who the gift is from.">
            <Input
              value={senderName}
              maxLength={MAX_NAME}
              autoComplete="off"
              onChange={(event) => setSenderName(event.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={showName && senderName.trim() !== ""}
              disabled={senderName.trim() === ""}
              onCheckedChange={(checked) => setShowName(checked === true)}
            />
            Show the name on the fundraiser page
          </label>
        </form>
        {error && (
          <Callout tone="danger" title={error.title}>
            {error.hint}
          </Callout>
        )}
        <DialogFooter>
          <Button disabled={attach.isPending} onClick={() => onOpenChange(false)}>
            {strings.actions.cancel}
          </Button>
          <Button
            type="submit"
            form={`attach-fundraiser-${donation.id}`}
            variant="primary"
            pending={attach.isPending}
          >
            Add to fundraiser
          </Button>
        </DialogFooter>
      </DialogContent>
      {guard.dialog}
    </Dialog>
  );
}

/** Stops a donation counting towards its fundraiser. */
export function RemoveFromFundraiserDialog({
  donation,
  fundraiserId,
}: {
  donation: Donation;
  fundraiserId: number;
}) {
  const trpc = useTRPC();
  const invalidate = useInvalidate(donation);
  const detach = useMutation(trpc.reports.fundraisers.detachDonation.mutationOptions());
  return (
    <ConfirmDialog
      title={`Remove donation #${donation.id} from fundraiser #${fundraiserId}?`}
      consequences={[
        <>
          The fundraiser's total goes down by <strong>{formatAmount(donation.sum)}</strong>, and the
          gift and its message no longer show on the fundraiser page.
        </>,
        "The donation moves to a KID with the same donor, tax unit and split that is not in a fundraiser. Its amount, date and tax deduction don't change.",
        "Other donations on the fundraiser KID (e.g. later charges of an agreement) still count towards the fundraiser.",
      ]}
      confirmLabel="Remove from fundraiser"
      onConfirm={async () => {
        await detach.mutateAsync({ donationId: donation.id });
        await invalidate();
        notify.success("Removed from fundraiser", `#${donation.id} · fundraiser #${fundraiserId}`);
      }}
      trigger={
        <Button>
          <FlagOffIcon />
          Remove from fundraiser…
        </Button>
      }
    />
  );
}
