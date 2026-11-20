import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRightIcon, GiftIcon } from "lucide-react";
import { useRecordParams } from "@/components/panels";
import { Callout } from "@/components/domain/callout";
import { CopyValue } from "@/components/domain/copy-value";
import { EmptyState } from "@/components/domain/empty-state";
import { ErrorState } from "@/components/domain/error-state";
import { DateTime, Money } from "@/components/domain/format";
import { Property, PropertyList } from "@/components/domain/property-list";
import { Status } from "@/components/domain/status";
import { DetailPage, DetailPanel, PageSection } from "@/components/templates";
import { SkeletonText } from "@/components/ui/skeleton";
import { GiftcardActions } from "@/features/giftcards/giftcard-actions";
import { deliveryLabel, displayStatus, type Giftcard } from "@/features/giftcards/model";
import { notify } from "@/lib/notify";
import { loadPage } from "@/lib/route-data";
import { giftcardStatus } from "@/lib/status";
import { errorCode, useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_app/giftcards/$id")({
  loader: async ({ context: { queryClient, trpc }, params, cause }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return;
    await loadPage(queryClient, cause, trpc.giftcards.get.queryOptions({ id }));
  },
  component: GiftcardPage,
});

const breadcrumbs = [{ label: "Gift cards", to: "/giftcards" }];
const none = <span className="text-faint-foreground">–</span>;
const when = (value: string | null) =>
  value ? <DateTime value={value} format="datetime" /> : none;

function GiftcardPage() {
  const { id } = useRecordParams(Route);
  const giftcardId = Number(id);
  if (!Number.isInteger(giftcardId) || giftcardId <= 0) {
    return (
      <EmptyState
        icon={GiftIcon}
        title="No such gift card"
        description={`“${id}” isn't a gift card ID.`}
        className="flex-1"
      />
    );
  }
  return <GiftcardRecord giftcardId={giftcardId} />;
}

function GiftcardRecord({ giftcardId }: { giftcardId: number }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery(trpc.giftcards.get.queryOptions({ id: giftcardId }));
  const retry = useMutation(trpc.giftcards.retry.mutationOptions());
  const reschedule = useMutation(trpc.giftcards.reschedule.mutationOptions());
  const cancel = useMutation(trpc.giftcards.cancel.mutationOptions());

  if (query.isPending) {
    return (
      <DetailPage
        breadcrumbs={breadcrumbs}
        title={`Gift card #${giftcardId}`}
        meta={[<SkeletonText key="product">0 × Product name here</SkeletonText>]}
        aside={
          <DetailPanel title="Gift card">
            <PropertyList labelWidth="8rem">
              {["Status", "Buyer", "Recipient", "Phone", "Send at", "KID"].map((label) => (
                <Property key={label} label={label} pending />
              ))}
            </PropertyList>
          </DetailPanel>
        }
      >
        <PageSection title="Greeting">
          <SkeletonText>Some words from the sender</SkeletonText>
        </PageSection>
      </DetailPage>
    );
  }
  if (query.isError) {
    return (
      <div className="p-6">
        <ErrorState
          back={{ to: "/giftcards", label: "All gift cards" }}
          error={query.error}
          title={
            errorCode(query.error) === "NOT_FOUND"
              ? `No gift card #${giftcardId}`
              : "Couldn't load the gift card"
          }
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const giftcard: Giftcard = query.data;
  const run = async (action: Promise<unknown>, message: string) => {
    await action;
    await queryClient.invalidateQueries({ queryKey: trpc.giftcards.pathKey() });
    notify.success(message, `Gift card to ${giftcard.recipientName}`);
  };
  const buyer = giftcard.donorId ? (
    <Link
      to="/donors/$id"
      params={{ id: String(giftcard.donorId) }}
      className="rounded-xs font-semibold text-accent hover:underline focus-ring"
    >
      {giftcard.donorName || giftcard.donorEmail || `Donor #${giftcard.donorId}`}
    </Link>
  ) : (
    none
  );

  return (
    <DetailPage
      breadcrumbs={breadcrumbs}
      title={`Gift card to ${giftcard.recipientName}`}
      adornment={<Status catalog={giftcardStatus} value={displayStatus(giftcard)} />}
      meta={[
        <span key="product">
          {giftcard.units} {giftcard.unit ?? ""} · {giftcard.productName}
        </span>,
        <span key="amount">
          <Money value={giftcard.amount} />
        </span>,
        <span key="from">From {giftcard.senderName}</span>,
      ]}
      actions={
        <GiftcardActions
          giftcard={giftcard}
          onRetry={() => run(retry.mutateAsync({ id: giftcard.id }), "SMS will be sent again")}
          onReschedule={(sendAt) =>
            run(reschedule.mutateAsync({ id: giftcard.id, sendAt }), "Send time changed")
          }
          onCancel={() => run(cancel.mutateAsync({ id: giftcard.id }), "Gift card cancelled")}
        />
      }
      aside={
        <DetailPanel title="Gift card">
          <PropertyList labelWidth="8rem">
            <Property label="Status">
              <Status catalog={giftcardStatus} value={displayStatus(giftcard)} />
            </Property>
            <Property label="Buyer">{buyer}</Property>
            <Property label="Buyer email">
              {giftcard.donorEmail ? <CopyValue value={giftcard.donorEmail} label="email" /> : none}
            </Property>
            <Property label="Recipient">{giftcard.recipientName}</Property>
            <Property label="Phone">
              {giftcard.recipientPhone ? (
                <CopyValue value={giftcard.recipientPhone} label="phone" />
              ) : (
                none
              )}
            </Property>
            <Property label="Sender">{giftcard.senderName}</Property>
            <Property label="Delivery">{deliveryLabel[giftcard.delivery]}</Property>
            <Property label="Send at">{when(giftcard.sendAt)}</Property>
            <Property label="Paid">{when(giftcard.paidAt)}</Property>
            <Property label="Sent">{when(giftcard.sentAt)}</Property>
            <Property label="Send attempts">
              <span className="num">{giftcard.sendAttempts}</span>
            </Property>
            <Property label="Buyer told">{when(giftcard.senderNotifiedAt)}</Property>
            <Property label="Bought">{when(giftcard.created)}</Property>
            <Property label="KID">
              <Link
                to="/distributions/$kid"
                params={{ kid: giftcard.KID }}
                className="num underline-offset-2 hover:underline"
              >
                {giftcard.KID}
              </Link>
            </Property>
            {giftcard.smsProviderId && (
              <Property label="SMS id">
                <CopyValue value={giftcard.smsProviderId} label="SMS id" />
              </Property>
            )}
            <Property label="Gift card ID">
              <CopyValue value={giftcard.id} prefix="#" label="gift card ID" />
            </Property>
          </PropertyList>
        </DetailPanel>
      }
    >
      {giftcard.lastError && (
        <Callout
          tone={giftcard.status === "failed" ? "danger" : "neutral"}
          title={giftcard.status === "failed" ? "The SMS couldn't be sent" : "Last send error"}
        >
          {giftcard.lastError}
        </Callout>
      )}
      <PageSection title="Greeting">
        {giftcard.message ? (
          <p className="max-w-prose whitespace-pre-wrap">{giftcard.message}</p>
        ) : (
          <p className="text-muted-foreground">No greeting.</p>
        )}
      </PageSection>
      {giftcard.smsText && (
        <PageSection
          title={giftcard.status === "sent" ? "SMS as sent" : "SMS as it will be sent"}
          description="From the product's current SMS template."
        >
          <pre className="max-w-md rounded-md border border-border bg-surface p-3 font-sans text-sm whitespace-pre-wrap">
            {giftcard.smsText}
          </pre>
        </PageSection>
      )}
      <PageSection
        title="Recipient page"
        description="Shown once the gift card is paid; never when it's cancelled."
      >
        {giftcard.recipientUrl ? (
          <a
            href={giftcard.recipientUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
          >
            {giftcard.recipientUrl}
            <ArrowUpRightIcon className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <p className="text-muted-foreground">This gift card has no personal page.</p>
        )}
      </PageSection>
      <PageSection title="Donations on this KID">
        {giftcard.donations.length ? (
          <ul className="grid gap-1">
            {giftcard.donations.map((donation) => (
              <li key={donation.id}>
                <Link
                  to="/donations/$id"
                  params={{ id: String(donation.id) }}
                  className="underline-offset-2 hover:underline"
                >
                  <Money value={donation.sum} />
                </Link>{" "}
                <span className="text-muted-foreground">
                  {donation.date && <DateTime value={donation.date} />}
                  {donation.method && ` · ${donation.method}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">Not paid yet.</p>
        )}
      </PageSection>
    </DetailPage>
  );
}
