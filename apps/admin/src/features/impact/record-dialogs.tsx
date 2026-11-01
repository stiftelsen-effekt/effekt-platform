/**
 * Create/edit dialogs for Impact › Charities & interventions (several fields, explicit save:
 * RecordDialog). IDs never change, and a charity's abbreviation is fixed once created: Sanity's
 * intervention widget blocks and third-party calculators key on them.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OrganizationPicker } from "@/features/regranting/ui";
import { RecordDialog, textError } from "@/features/settings/record-dialog";
import { notify } from "@/lib/notify";
import { strings } from "@/lib/strings";
import { useTRPC } from "@/lib/trpc";
import {
  languageLabels,
  textLanguages,
  type ImpactCharity,
  type ImpactIntervention,
  type TextLanguage,
} from "./model";

function useInvalidate() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trpc.impact.pathKey() });
}

type CharityForm = { name: string; abbreviation: string; organizationId: number | null };

export function validateCharity(v: CharityForm, isNew: boolean) {
  return {
    name: textError(v.name, { label: "a name", max: 200, required: true }),
    abbreviation:
      isNew && !/^[A-Z0-9]{1,10}$/.test(v.abbreviation.trim().toUpperCase())
        ? "1–10 letters or digits, like AMF"
        : undefined,
  };
}

export function CharityDialog({
  charity,
  trigger,
}: {
  charity?: ImpactCharity;
  trigger: ReactNode;
}) {
  const trpc = useTRPC();
  const invalidate = useInvalidate();
  const create = useMutation(trpc.impact.charities.create.mutationOptions());
  const update = useMutation(trpc.impact.charities.update.mutationOptions());
  return (
    <RecordDialog<CharityForm>
      trigger={trigger}
      title={charity ? `Edit ${charity.name}` : "New charity"}
      description="Donations to the linked organization use this charity's estimates. One charity per organization."
      initial={() => ({
        name: charity?.name ?? "",
        abbreviation: charity?.abbreviation ?? "",
        organizationId: charity?.organizationId ?? null,
      })}
      validate={(v) => validateCharity(v, !charity)}
      saveLabel={charity ? strings.actions.saveChanges : "Create charity"}
      onSave={async (v) => {
        if (charity)
          await update.mutateAsync({
            id: charity.id,
            name: v.name.trim(),
            organizationId: v.organizationId,
          });
        else
          await create.mutateAsync({
            name: v.name.trim(),
            abbreviation: v.abbreviation.trim(),
            organizationId: v.organizationId,
          });
        await invalidate();
        notify.success(charity ? "Charity updated" : "Charity created", v.name.trim());
      }}
    >
      {({ values, set, errors }) => (
        <>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <Field label="Name" required error={errors.name}>
              <Input value={values.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field
              label="Abbreviation"
              required={!charity}
              hint={charity ? "Fixed: others key on it" : "Can't change later"}
              error={errors.abbreviation}
            >
              <Input
                className="num"
                disabled={!!charity}
                value={values.abbreviation}
                onChange={(e) => set({ abbreviation: e.target.value.toUpperCase() })}
              />
            </Field>
          </div>
          <Field
            label="Organization"
            hint={
              charity?.organizationId && values.organizationId !== charity.organizationId
                ? "Changing it changes which donations show this charity's impact on Min Side"
                : "Leave empty while no donations should use it"
            }
            error={errors.organizationId}
          >
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <OrganizationPicker
                  value={values.organizationId}
                  onValueChange={(organizationId) => set({ organizationId })}
                />
              </div>
              {values.organizationId !== null && (
                <Button type="button" variant="ghost" onClick={() => set({ organizationId: null })}>
                  Unlink
                </Button>
              )}
            </div>
          </Field>
        </>
      )}
    </RecordDialog>
  );
}

type Text = { shortDescription: string; longDescription: string };
type InterventionForm = Text & { texts: Record<TextLanguage, Text> };

export function validateIntervention(v: InterventionForm) {
  const errors: Record<string, string | undefined> = {
    shortDescription: textError(v.shortDescription, {
      label: "a short text",
      max: 100,
      required: true,
    }),
    longDescription: textError(v.longDescription, { label: "the long text", max: 1000 }),
  };
  for (const language of textLanguages) {
    const t = v.texts[language];
    if (!t.shortDescription.trim() && t.longDescription.trim())
      errors[`texts.${language}.shortDescription`] = "Give a short text, or leave both empty";
    errors[`texts.${language}.shortDescription`] ??= textError(t.shortDescription, {
      label: "the short text",
      max: 100,
    });
    errors[`texts.${language}.longDescription`] = textError(t.longDescription, {
      label: "the long text",
      max: 1000,
    });
  }
  return errors;
}

/** Languages with a short text are sent; an empty language shows the English */
export function interventionInput(v: InterventionForm) {
  const texts: Partial<Record<TextLanguage, Text>> = {};
  for (const language of textLanguages) {
    const t = v.texts[language];
    if (t.shortDescription.trim())
      texts[language] = {
        shortDescription: t.shortDescription.trim(),
        longDescription: t.longDescription.trim(),
      };
  }
  return {
    shortDescription: v.shortDescription.trim(),
    longDescription: v.longDescription.trim(),
    texts,
  };
}

export function InterventionDialog({
  intervention,
  trigger,
}: {
  intervention?: ImpactIntervention;
  trigger: ReactNode;
}) {
  const trpc = useTRPC();
  const invalidate = useInvalidate();
  const create = useMutation(trpc.impact.interventions.create.mutationOptions());
  const update = useMutation(trpc.impact.interventions.update.mutationOptions());
  return (
    <RecordDialog<InterventionForm>
      trigger={trigger}
      contentClassName="sm:max-w-3xl"
      title={intervention ? `Edit ${intervention.shortDescription}` : "New intervention"}
      description="Min Side, receipts and the intervention widget show the short text. A language left empty shows the English."
      initial={() => ({
        shortDescription: intervention?.shortDescription ?? "",
        longDescription: intervention?.longDescription ?? "",
        texts: Object.fromEntries(
          textLanguages.map((language) => [
            language,
            {
              shortDescription: intervention?.texts[language]?.shortDescription ?? "",
              longDescription: intervention?.texts[language]?.longDescription ?? "",
            },
          ]),
        ) as Record<TextLanguage, Text>,
      })}
      validate={validateIntervention}
      saveLabel={intervention ? strings.actions.saveChanges : "Create intervention"}
      onSave={async (v) => {
        const input = interventionInput(v);
        if (intervention) await update.mutateAsync({ id: intervention.id, ...input });
        else await create.mutateAsync(input);
        await invalidate();
        notify.success(
          intervention ? "Intervention updated" : "Intervention created",
          input.shortDescription,
        );
      }}
    >
      {({ values, set, errors }) => (
        <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
          {(["en", ...textLanguages] as const).map((language) => {
            const text = language === "en" ? values : values.texts[language];
            const setText = (patch: Partial<Text>) =>
              language === "en"
                ? set(patch)
                : set({
                    texts: { ...values.texts, [language]: { ...values.texts[language], ...patch } },
                  });
            const key = (field: keyof Text) =>
              language === "en" ? field : `texts.${language}.${field}`;
            const name = language === "en" ? "English" : languageLabels[language];
            return (
              <fieldset
                key={language}
                className="grid gap-2 sm:grid-cols-[8rem_minmax(0,14rem)_minmax(0,1fr)] sm:gap-3"
              >
                <legend className="sr-only">{name}</legend>
                <span aria-hidden className="pt-7 text-sm font-semibold">
                  {name}
                </span>
                <Field
                  label={`Short text, ${name}`}
                  required={language === "en"}
                  error={errors[key("shortDescription")]}
                >
                  <Input
                    value={text.shortDescription}
                    placeholder={language === "en" ? "Bednets" : values.shortDescription}
                    onChange={(e) => setText({ shortDescription: e.target.value })}
                  />
                </Field>
                <Field label={`Long text, ${name}`} error={errors[key("longDescription")]}>
                  <Textarea
                    rows={2}
                    value={text.longDescription}
                    onChange={(e) => setText({ longDescription: e.target.value })}
                  />
                </Field>
              </fieldset>
            );
          })}
        </div>
      )}
    </RecordDialog>
  );
}
