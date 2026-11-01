/**
 * Impact › Charities & interventions: the charities GiveWell estimates cover (linked to our
 * organizations) and what their outputs are called in each language.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/domain/empty-state";
import { ErrorState } from "@/components/domain/error-state";
import { SettingsSection } from "@/components/templates";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import {
  languageLabels,
  textLanguages,
  type ImpactCharity,
  type ImpactIntervention,
} from "./model";
import { CharityLink, UsdCents } from "./ui";

const th =
  "text-left text-xs text-muted-foreground [&>th]:border-b [&>th]:border-border [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold";
const td =
  "[&>td]:border-b [&>td]:border-border [&>td]:px-3 [&>td]:py-1.5 [&>td]:align-top last:[&>td]:border-b-0";

export function TableShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm" aria-label={label}>
        {children}
      </table>
    </div>
  );
}

function Loading<T>({
  query,
  empty,
  children,
}: {
  query: { data?: T[]; error: unknown; refetch: () => unknown };
  empty: ReactNode;
  children: (rows: T[]) => ReactNode;
}) {
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <div className="h-28" aria-busy />;
  if (query.data.length === 0) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

export function CharitiesSection({
  actions,
  rowActions,
}: {
  actions?: ReactNode;
  rowActions?: (charity: ImpactCharity) => ReactNode;
}) {
  const trpc = useTRPC();
  const charities = useQuery(trpc.impact.charities.list.queryOptions());
  return (
    <SettingsSection
      title="Charities"
      description={
        <>
          <p>
            The charities GiveWell's estimates are for. A donation to an organization uses the
            estimates of the charity linked to it.
          </p>
          <p className="mt-2">
            Others use the IDs and abbreviations: Sanity's intervention widget blocks store the
            abbreviation, and third-party calculators read both. They never change.
          </p>
        </>
      }
      actions={actions}
    >
      <Loading
        query={charities}
        empty={
          <EmptyState
            size="sm"
            title="No charities yet"
            className="rounded-md border border-border"
          />
        }
      >
        {(rows) => (
          <TableShell label="Charities">
            <thead>
              <tr className={th}>
                <th scope="col">Charity</th>
                <th scope="col">Abbreviation</th>
                <th scope="col">Organization</th>
                <th scope="col" className="text-right">
                  Cost per output now
                </th>
                <th scope="col" className="text-right">
                  Estimates
                </th>
                {rowActions && (
                  <th scope="col" className="w-12">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={td}>
                  <td className="font-semibold">
                    <CharityLink charityId={c.id}>{c.name}</CharityLink>
                    <div className="num text-xs font-normal text-muted-foreground">ID {c.id}</div>
                  </td>
                  <td>
                    <Badge>{c.abbreviation}</Badge>
                  </td>
                  <td>
                    {c.organizationName ?? (
                      <span className="text-muted-foreground">Not linked</span>
                    )}
                  </td>
                  <td className="text-right">
                    {c.currentEstimate ? (
                      <>
                        <UsdCents value={c.currentEstimate.centsPerOutput} />
                        <div className="text-xs text-muted-foreground">
                          {c.currentEstimate.interventionName}, since{" "}
                          {formatDate(c.currentEstimate.validFrom, "month")}
                        </div>
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className="num text-right">{c.estimates}</td>
                  {rowActions && <td>{rowActions(c)}</td>}
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Loading>
    </SettingsSection>
  );
}

export function InterventionsSection({
  actions,
  rowActions,
}: {
  actions?: ReactNode;
  rowActions?: (intervention: ImpactIntervention) => ReactNode;
}) {
  const trpc = useTRPC();
  const interventions = useQuery(trpc.impact.interventions.list.queryOptions());
  return (
    <SettingsSection
      title="Interventions"
      description={
        <>
          <p>
            What an output is, in English and the languages our sites use. Min Side, receipts and
            the intervention widget show the short text; a language without its own text shows the
            English.
          </p>
        </>
      }
      actions={actions}
    >
      <Loading
        query={interventions}
        empty={
          <EmptyState
            size="sm"
            title="No interventions yet"
            className="rounded-md border border-border"
          />
        }
      >
        {(rows) => (
          <TableShell label="Interventions">
            <thead>
              <tr className={th}>
                <th scope="col">English</th>
                {textLanguages.map((language) => (
                  <th key={language} scope="col">
                    {languageLabels[language]}
                  </th>
                ))}
                <th scope="col" className="text-right">
                  Used by
                </th>
                {rowActions && (
                  <th scope="col" className="w-12">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className={td}>
                  <td className="max-w-56">
                    <div className="font-semibold">{i.shortDescription}</div>
                    <div
                      className="truncate text-xs text-muted-foreground"
                      title={i.longDescription}
                    >
                      {i.longDescription}
                    </div>
                  </td>
                  {textLanguages.map((language) => {
                    const text = i.texts[language];
                    return (
                      <td key={language} className="max-w-44">
                        {text ? (
                          <>
                            <div>{text.shortDescription}</div>
                            <div
                              className="truncate text-xs text-muted-foreground"
                              title={text.longDescription}
                            >
                              {text.longDescription}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground" title="Shows the English text">
                            –
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-right text-muted-foreground">
                    <div className="num whitespace-nowrap">
                      {i.estimates} {i.estimates === 1 ? "estimate" : "estimates"}
                    </div>
                    <div className="num text-xs whitespace-nowrap">
                      {i.allotments} {i.allotments === 1 ? "allotment" : "allotments"}
                    </div>
                  </td>
                  {rowActions && <td>{rowActions(i)}</td>}
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Loading>
    </SettingsSection>
  );
}
