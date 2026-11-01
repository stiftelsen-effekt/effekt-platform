import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Callout } from "@/components/domain/callout";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { UnsavedChangesBar } from "@/components/domain/unsaved-changes";
import { DetailPage, PageSection } from "@/components/templates";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { notify } from "@/lib/notify";
import { fieldErrors, useTRPC } from "@/lib/trpc";
import {
  draftShares,
  formatShare,
  grantAllotments,
  grantDraft,
  grantValid,
  newAllotment,
  parseMonthText,
  validateGrant,
  type AllotmentDraft,
  type GrantDraft,
} from "./forms";
import { formatUsdCents, fundLabels, impactFunds, type ImpactGrant } from "./model";
import { GrantSplit } from "./split";

/**
 * Add or correct a fund grant and its allotments. The split is each allotment's sum over the
 * grant's total, as the API computes it, so the shares always add up to 100 %; every sum and
 * output count must be above 0. Saving changes what donors to the fund see for the grant's
 * months, so it is confirmed with the split before → after.
 */
export function GrantForm({ grant }: { grant?: ImpactGrant }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const charities = useQuery(trpc.impact.charities.list.queryOptions());
  const interventions = useQuery(trpc.impact.interventions.list.queryOptions());
  const create = useMutation(trpc.impact.grants.create.mutationOptions());
  const update = useMutation(trpc.impact.grants.update.mutationOptions());
  const [initial] = useState(() => grantDraft(grant));
  const [draft, setDraft] = useState<GrantDraft>(initial);
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [server, setServer] = useState<Record<string, string>>({});
  const [savedId, setSavedId] = useState<number | null>(null);

  const errors = validateGrant(draft);
  const valid = grantValid(errors);
  const dirty = savedId === null && JSON.stringify(draft) !== JSON.stringify(initial);
  const shares = draftShares(draft);
  const charityName = (id: string) =>
    charities.data?.find((c) => String(c.id) === id)?.name ?? "Charity";

  useEffect(() => {
    if (savedId !== null)
      void navigate({ to: "/impact/grants/$id", params: { id: String(savedId) } });
  }, [savedId, navigate]);

  const setRow = (key: string, patch: Partial<AllotmentDraft>) =>
    setDraft((d) => ({
      ...d,
      allotments: d.allotments.map((a) => (a.key === key ? { ...a, ...patch } : a)),
    }));
  const show = (message: string | undefined, serverKey: string) =>
    server[serverKey] ?? (touched ? message : undefined);

  async function save() {
    const input = {
      validFrom: parseMonthText(draft.month)!,
      allotments: grantAllotments(draft),
    };
    try {
      const { id } = grant
        ? await update.mutateAsync({ id: grant.id, ...input })
        : await create.mutateAsync({ fund: draft.fund, ...input });
      await queryClient.invalidateQueries({ queryKey: trpc.impact.pathKey() });
      notify.success(grant ? "Grant saved" : "Grant added", fundLabels[draft.fund]);
      setSavedId(id);
    } catch (err) {
      const mapped = Object.fromEntries(
        Object.entries(fieldErrors(err)).flatMap(([key, messages]) =>
          messages?.[0] ? [[key, messages[0]]] : [],
        ),
      );
      if (Object.keys(mapped).length > 0) {
        setServer(mapped);
        setConfirming(false);
        return;
      }
      throw err;
    }
  }

  const before = grant?.allotments ?? [];
  const month = parseMonthText(draft.month);
  const parts = draft.allotments.map((a, i) => ({
    charityId: Number(a.charityId) || -(i + 1),
    charityName: charityName(a.charityId),
    organizationId:
      charities.data?.find((c) => String(c.id) === a.charityId)?.organizationId ?? null,
    share: shares[i]!.share,
  }));

  return (
    <DetailPage
      breadcrumbs={[
        { label: "Fund grants", to: "/impact/grants" },
        ...(grant
          ? [
              {
                label: `${grant.fund}, ${formatDate(grant.validFrom, "month")}`,
                to: `/impact/grants/${grant.id}`,
              },
            ]
          : []),
      ]}
      title={grant ? "Edit grant" : "New fund grant"}
      meta={grant ? [fundLabels[grant.fund], `Grant #${grant.id}`] : []}
    >
      <div className="grid max-w-5xl gap-8">
        <PageSection title="Grant">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fund" hint={grant ? "A grant's fund can't change" : undefined}>
              {grant ? (
                <Input value={fundLabels[grant.fund]} disabled />
              ) : (
                <SegmentedControl
                  label="Fund"
                  value={draft.fund}
                  onValueChange={(fund) => setDraft((d) => ({ ...d, fund }))}
                  options={impactFunds.map((f) => ({ value: f, label: fundLabels[f] }))}
                />
              )}
            </Field>
            <Field
              label="From month"
              required
              hint="mm.yyyy. Donations to the fund from this month on are split like this grant."
              error={show(errors.month, "validFrom")}
            >
              <Input
                className="num"
                placeholder="02.2025"
                value={draft.month}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, month: e.target.value }));
                  setServer({});
                }}
              />
            </Field>
          </div>
        </PageSection>
        <PageSection
          title="Allotments"
          description="What GiveWell granted to each charity from the fund, and the outputs it buys. Shares follow from the sums."
          actions={
            <Button
              onClick={() =>
                setDraft((d) => ({ ...d, allotments: [...d.allotments, newAllotment()] }))
              }
            >
              <PlusIcon />
              Add allotment
            </Button>
          }
        >
          {touched && errors.allotments && (
            <p className="text-xs text-danger" role="alert">
              {errors.allotments}
            </p>
          )}
          <ol className="grid gap-3">
            {draft.allotments.map((a, i) => {
              const rowErrors = errors.rows[i] ?? {};
              const s = shares[i]!;
              return (
                <li
                  key={a.key}
                  aria-label={`Allotment ${i + 1}`}
                  className="grid gap-3 rounded-md border border-border p-3"
                >
                  <div className="grid gap-3 sm:grid-cols-[1.4fr_1.2fr_1fr_1fr_auto]">
                    <Field
                      label="Charity"
                      required
                      error={
                        show(rowErrors.charityId, `allotments.${i}.charityId`) ??
                        server[`allotments.${i}`]
                      }
                    >
                      <Select
                        value={a.charityId}
                        onValueChange={(charityId) => setRow(a.key, { charityId })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a charity" />
                        </SelectTrigger>
                        <SelectContent>
                          {(charities.data ?? []).map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field
                      label="Intervention"
                      required
                      error={show(rowErrors.interventionId, `allotments.${i}.interventionId`)}
                    >
                      <Select
                        value={a.interventionId}
                        onValueChange={(interventionId) => setRow(a.key, { interventionId })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          {(interventions.data ?? []).map((iv) => (
                            <SelectItem key={iv.id} value={String(iv.id)}>
                              {iv.shortDescription}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field
                      label="Sum (USD)"
                      required
                      error={show(rowErrors.sum, `allotments.${i}.sumInCents`)}
                    >
                      <Input
                        className="num"
                        inputMode="decimal"
                        value={a.sum}
                        onChange={(e) => setRow(a.key, { sum: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="Outputs bought"
                      required
                      error={show(rowErrors.outputs, `allotments.${i}.numberOutputsPurchased`)}
                    >
                      <Input
                        className="num"
                        inputMode="numeric"
                        value={a.outputs}
                        onChange={(e) => setRow(a.key, { outputs: e.target.value })}
                      />
                    </Field>
                    <div className="flex items-end gap-2 pb-1">
                      <div className="text-right text-xs text-muted-foreground">
                        <div
                          className="num font-semibold text-foreground"
                          data-testid={`share-${i}`}
                        >
                          {formatShare(s.share)}
                        </div>
                        <div className="num">{formatUsdCents(s.centsPerOutput)}</div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove allotment ${i + 1}`}
                        disabled={draft.allotments.length === 1}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            allotments: d.allotments.filter((x) => x.key !== a.key),
                          }))
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Source">
                      <Input
                        value={a.sourceName}
                        onChange={(e) => setRow(a.key, { sourceName: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="Link"
                      error={show(rowErrors.sourceUrl, `allotments.${i}.sourceUrl`)}
                    >
                      <Input
                        value={a.sourceUrl}
                        onChange={(e) => setRow(a.key, { sourceUrl: e.target.value })}
                      />
                    </Field>
                  </div>
                </li>
              );
            })}
          </ol>
        </PageSection>
        <PageSection
          title="Split"
          description="Each charity's share of the grant, from the sums above."
        >
          <GrantSplit parts={parts} />
        </PageSection>
        {server[""] && <Callout tone="danger">{server[""]}</Callout>}
        <UnsavedChangesBar
          dirty={dirty}
          saving={create.isPending || update.isPending}
          saveLabel={grant ? "Save grant…" : "Add grant…"}
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
          grant
            ? `Save the ${grant.fund} grant from ${month ? formatDate(month, "month") : ""}?`
            : `Add a ${draft.fund} grant from ${month ? formatDate(month, "month") : ""}?`
        }
        description={`Donations to the ${fundLabels[draft.fund]} from that month until the next grant are split like this. Donors see the new split on Min Side.`}
        consequences={[
          ...(grant && grant.validFrom !== month
            ? [
                `From ${formatDate(grant.validFrom, "month")} → ${month ? formatDate(month, "month") : ""}`,
              ]
            : []),
          ...draft.allotments.map((a, i) => {
            const old = before.find((b) => b.id === a.id);
            return (
              <span key={a.key}>
                {charityName(a.charityId)}:{" "}
                {old && <span className="num">{formatShare(old.share)} → </span>}
                <strong className="num">{formatShare(shares[i]!.share)}</strong>,{" "}
                <span className="num">{formatUsdCents(shares[i]!.centsPerOutput)}</span> per output
              </span>
            );
          }),
          ...before
            .filter((b) => !draft.allotments.some((a) => a.id === b.id))
            .map((b) => `Removed: ${b.charityName} (${formatShare(b.share)})`),
        ]}
        confirmLabel={grant ? "Save grant" : "Add grant"}
        onConfirm={save}
      />
    </DetailPage>
  );
}
