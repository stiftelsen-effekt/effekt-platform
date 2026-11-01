import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Callout } from "@/components/domain/callout";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { describeError } from "@/components/domain/error-state";
import { Money } from "@/components/domain/format";
import { UnsavedChangesBar } from "@/components/domain/unsaved-changes";
import { DetailPage, PageSection } from "@/components/templates";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Updating } from "@/components/ui/pending";
import { formatDate, formatNumber } from "@/lib/format";
import { notify } from "@/lib/notify";
import { fieldErrors, useTRPC } from "@/lib/trpc";
import {
  estimateDraft,
  estimateFieldOf,
  estimateValues,
  validateEstimate,
  type EstimateField,
} from "./forms";
import {
  formatMonthRange,
  formatMonths,
  formatUsdCents,
  type ImpactEstimate,
  type ImpactTimeline,
} from "./model";

/**
 * Add or correct one of a charity's cost estimates. It changes what donors see for gifts already
 * made ("moves money" on the risk ladder, docs/admin-design.md), so saving goes through a
 * confirmation with the cost before → after and the donations whose figure changes
 * (impact.estimates.preview), which the page also shows while typing.
 */
export function EstimateForm({
  timeline,
  estimate,
}: {
  timeline: ImpactTimeline;
  /** The estimate to correct; none for a new one */
  estimate?: ImpactEstimate;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const interventions = useQuery(trpc.impact.interventions.list.queryOptions());
  const create = useMutation(trpc.impact.estimates.create.mutationOptions());
  const update = useMutation(trpc.impact.estimates.update.mutationOptions());
  const charity = timeline.charity;
  // A new estimate starts with the intervention of the one in effect
  const [initial] = useState(() =>
    estimateDraft(estimate, timeline.estimates.find((e) => e.current)?.interventionId),
  );
  const [draft, setDraft] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [server, setServer] = useState<Partial<Record<EstimateField, string>>>({});
  const [saved, setSaved] = useState(false);

  const errors = validateEstimate(draft, { requireSource: !estimate });
  const valid = Object.keys(errors).length === 0;
  const dirty = !saved && JSON.stringify(draft) !== JSON.stringify(initial);
  const values = valid ? estimateValues(draft) : null;

  const preview = useQuery({
    ...trpc.impact.estimates.preview.queryOptions(
      values
        ? {
            ...(estimate ? { id: estimate.id } : {}),
            charityId: charity.id,
            interventionId: values.interventionId,
            validFrom: values.validFrom,
            centsPerOutput: values.centsPerOutput,
          }
        : { charityId: charity.id, interventionId: 1, validFrom: "2000-01-01", centsPerOutput: 1 },
    ),
    enabled: values !== null,
    placeholderData: (previous) => previous,
  });
  const p = values ? preview.data : undefined;

  const back = () =>
    void navigate({
      to: "/impact/estimates/$charityId",
      params: { charityId: String(charity.id) },
    });
  useEffect(() => {
    if (saved) back();
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- leave once, after the save rendered
  }, [saved]);

  const set = (patch: Partial<typeof draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setServer((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key as EstimateField];
      return next;
    });
  };
  const shown = (field: EstimateField) => server[field] ?? (touched ? errors[field] : undefined);

  async function save() {
    try {
      if (estimate) await update.mutateAsync({ id: estimate.id, ...values! });
      else await create.mutateAsync({ charityId: charity.id, ...values! });
    } catch (err) {
      const mapped = Object.fromEntries(
        Object.entries(fieldErrors(err)).flatMap(([key, messages]) =>
          estimateFieldOf[key] && messages?.[0] ? [[estimateFieldOf[key], messages[0]]] : [],
        ),
      );
      if (Object.keys(mapped).length > 0) {
        setServer(mapped);
        setConfirming(false);
        return;
      }
      throw err;
    }
    await queryClient.invalidateQueries({ queryKey: trpc.impact.pathKey() });
    notify.success(estimate ? "Estimate saved" : "Estimate added", charity.name);
    setSaved(true);
  }

  const changes = p
    ? [
        <span key="cost">
          <span className="text-muted-foreground">Cost per output:</span>{" "}
          <span className="num">{formatUsdCents(p.before?.centsPerOutput ?? null)}</span> →{" "}
          <strong className="num font-semibold">
            {formatUsdCents(p.after?.centsPerOutput ?? null)}
          </strong>
        </span>,
        <span key="months">
          {p.changedMonths.length === 0
            ? "No month's figure changes"
            : `${p.changedMonths.map((r) => formatMonthRange(r.from, r.to)).join(", ")} (${formatMonths(p.monthsChanged)} so far)`}
        </span>,
        p.organizationLinked ? (
          <span key="donations">
            {formatNumber(p.donations)} donations from {formatNumber(p.donors)} donors show the new
            figure on Min Side
          </span>
        ) : (
          <span key="donations">No organization is linked, so no donation uses it yet</span>
        ),
      ]
    : [];

  return (
    <DetailPage
      breadcrumbs={[
        { label: "Cost estimates", to: "/impact/estimates" },
        { label: charity.name, to: `/impact/estimates/${charity.id}` },
      ]}
      title={estimate ? "Edit estimate" : "New estimate"}
      meta={[
        charity.name,
        charity.abbreviation,
        estimate ? `From ${formatDate(estimate.validFrom, "month")}` : null,
      ]}
    >
      <div className="grid max-w-3xl gap-8">
        {!estimate && (
          <Callout title="A new GiveWell number is a new estimate">
            Add it from the month it applies to; donations before that keep the earlier estimate.
            Edit an existing estimate only to correct it.
          </Callout>
        )}
        <PageSection title="Estimate">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Intervention" required error={shown("interventionId")}>
              <Select
                value={draft.interventionId}
                onValueChange={(interventionId) => set({ interventionId })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose what the money buys" />
                </SelectTrigger>
                <SelectContent>
                  {(interventions.data ?? []).map((i) => (
                    <SelectItem key={i.id} value={String(i.id)}>
                      {i.shortDescription}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="From month"
              required
              hint="mm.yyyy. Donations from this month on use it, until a newer estimate."
              error={shown("month")}
            >
              <Input
                className="num"
                placeholder="01.2026"
                value={draft.month}
                onChange={(e) => set({ month: e.target.value })}
              />
            </Field>
            <Field
              label="Cost per output"
              required
              hint="US dollars, as GiveWell gives it"
              error={shown("cost")}
            >
              <Input
                className="num"
                inputMode="decimal"
                placeholder="5,85"
                value={draft.cost}
                onChange={(e) => set({ cost: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Low end" hint="Optional" error={shown("low")}>
                <Input
                  className="num"
                  inputMode="decimal"
                  value={draft.low}
                  onChange={(e) => set({ low: e.target.value })}
                />
              </Field>
              <Field label="High end" hint="Optional" error={shown("high")}>
                <Input
                  className="num"
                  inputMode="decimal"
                  value={draft.high}
                  onChange={(e) => set({ high: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </PageSection>
        <PageSection title="Source">
          <div className="grid gap-4">
            <Field label="Source" required={!estimate} error={shown("sourceName")}>
              <Input
                placeholder="GiveWell cost-effectiveness analysis 2026"
                value={draft.sourceName}
                onChange={(e) => set({ sourceName: e.target.value })}
              />
            </Field>
            <Field
              label="Link"
              required={!estimate}
              hint="The GiveWell page or spreadsheet; several links one per line"
              error={shown("sourceUrl")}
            >
              <Textarea
                rows={2}
                value={draft.sourceUrl}
                onChange={(e) => set({ sourceUrl: e.target.value })}
              />
            </Field>
            <Field
              label="Comment"
              hint="How the number was worked out, if not obvious"
              error={shown("comment")}
            >
              <Textarea
                rows={3}
                value={draft.comment}
                onChange={(e) => set({ comment: e.target.value })}
              />
            </Field>
          </div>
        </PageSection>
        <PageSection
          title="What changes for donors"
          description="Min Side, receipts sent from now on and the results page use the latest estimate on or before each donation's month."
        >
          {!values ? (
            <p className="text-sm text-muted-foreground">Fill in the estimate to see its effect.</p>
          ) : preview.isError ? (
            <Callout tone="warning" title={describeError(preview.error).title}>
              {describeError(preview.error).hint}
            </Callout>
          ) : (
            <Updating active={preview.isFetching}>
              <dl
                className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]"
                data-testid="estimate-preview"
              >
                <dt className="text-muted-foreground">Cost per output</dt>
                <dd>
                  <span className="num">{formatUsdCents(p?.before?.centsPerOutput ?? null)}</span> →{" "}
                  <strong className="num">
                    {formatUsdCents(p?.after?.centsPerOutput ?? null)}
                  </strong>
                </dd>
                <dt className="text-muted-foreground">In NOK today</dt>
                <dd>
                  <Money value={p?.before?.costPerOutputNok ?? null} /> →{" "}
                  <strong>
                    <Money value={p?.after?.costPerOutputNok ?? null} />
                  </strong>
                </dd>
                <dt className="text-muted-foreground">Months that change</dt>
                <dd>
                  {!p
                    ? "–"
                    : p.changedMonths.length === 0
                      ? "None"
                      : `${p.changedMonths.map((r) => formatMonthRange(r.from, r.to)).join(", ")} · ${formatMonths(p.monthsChanged)} so far`}
                </dd>
                <dt className="text-muted-foreground">Donations affected</dt>
                <dd>
                  {!p
                    ? "–"
                    : p.organizationLinked
                      ? `${formatNumber(p.donations)} donations from ${formatNumber(p.donors)} donors`
                      : "None: the charity isn't linked to an organization"}
                </dd>
              </dl>
            </Updating>
          )}
        </PageSection>
        <UnsavedChangesBar
          dirty={dirty}
          saving={create.isPending || update.isPending}
          saveLabel={estimate ? "Save estimate…" : "Add estimate…"}
          onDiscard={() => {
            setDraft(initial);
            setTouched(false);
            setServer({});
          }}
          onSave={() => {
            setTouched(true);
            if (valid) setConfirming(true);
          }}
          invalid={touched && !valid ? "Fix the marked fields" : undefined}
        />
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          estimate
            ? `Change ${charity.abbreviation}'s estimate from ${values ? formatDate(values.validFrom, "month") : ""}?`
            : `Add an estimate for ${charity.abbreviation}?`
        }
        description="Donors see the new figure for their gifts in these months."
        consequences={changes}
        disabled={!p}
        confirmLabel={estimate ? "Save estimate" : "Add estimate"}
        onConfirm={save}
      />
    </DetailPage>
  );
}
