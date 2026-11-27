import React, { useEffect, useState } from "react";
import { Box, Button, Card, Flex, Spinner, Stack, Text, TextInput } from "@sanity/ui";
import { CloseIcon } from "@sanity/icons/Close";
import { SearchIcon } from "@sanity/icons/Search";
import { ArrayOfObjectsInputProps, PatchEvent, set, unset, useClient } from "sanity";

type ApiFundraiser = {
  id: number | string;
  donor: { name: string };
};

type FundraiserItem = {
  _key: string;
  name?: string;
  fundraiser_id?: string;
  fundraiser_page?: { _type: "reference"; _ref: string };
};

const api = process.env.SANITY_STUDIO_EFFEKT_API_URL;

const randomKey = () => Math.random().toString(36).slice(2, 12);

/**
 * Dropdown replacing the array's default "add item" UI: search the fundraisers registered in
 * the database (same /fundraisers/list the admin fundraiser picker uses) and add or remove them
 * from the leaderboard, instead of typing the name and ID by hand.
 */
export const FundraiserChartFundraisersInput = (props: ArrayOfObjectsInputProps) => {
  const client = useClient({ apiVersion: "2023-01-01" });
  const [options, setOptions] = useState<ApiFundraiser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const items = (props.value ?? []) as FundraiserItem[];
  const addedIds = new Set(items.map((item) => item.fundraiser_id));

  useEffect(() => {
    fetch(`${api}/fundraisers/list`)
      .then((res) => res.json())
      .then((data) => setOptions(data?.content ?? []))
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = options.filter((fundraiser) =>
    fundraiser.donor.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const addFundraiser = async (fundraiser: ApiFundraiser) => {
    const matchingPage = await client.fetch<string | null>(
      `*[_type == "fundraiser_page" && fundraiser_database_id == $id][0]._id`,
      { id: String(fundraiser.id) },
    );

    const newItem: FundraiserItem = {
      _key: randomKey(),
      name: fundraiser.donor.name,
      fundraiser_id: String(fundraiser.id),
      ...(matchingPage ? { fundraiser_page: { _type: "reference", _ref: matchingPage } } : {}),
    };

    props.onChange(PatchEvent.from(set([...items, newItem])));
  };

  const removeFundraiser = (key: string) => {
    const next = items.filter((item) => item._key !== key);
    props.onChange(PatchEvent.from(next.length > 0 ? set(next) : unset()));
  };

  return (
    <Stack gap={3}>
      <Stack gap={2}>
        {items.length === 0 ? (
          <Card padding={3} radius={2} tone="transparent" border>
            <Text size={1} muted>
              No fundraisers on the leaderboard yet.
            </Text>
          </Card>
        ) : (
          items.map((item) => (
            <Card key={item._key} padding={2} radius={2} border>
              <Flex align="center" justify="space-between">
                <Text size={1}>
                  {item.name} <Text muted>({item.fundraiser_id})</Text>
                </Text>
                <Button
                  icon={CloseIcon}
                  mode="bleed"
                  tone="critical"
                  onClick={() => removeFundraiser(item._key)}
                  aria-label={`Remove ${item.name}`}
                />
              </Flex>
            </Card>
          ))
        )}
      </Stack>

      <Card padding={3} radius={2} border>
        <Stack gap={3}>
          <TextInput
            icon={SearchIcon}
            placeholder="Search registered fundraisers by donor name"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
          />
          <Box style={{ maxHeight: "200px", overflow: "auto" }}>
            {loading ? (
              <Flex padding={3} justify="center">
                <Spinner />
              </Flex>
            ) : filtered.length === 0 ? (
              <Box padding={3}>
                <Text size={1} muted>
                  No matching fundraisers
                </Text>
              </Box>
            ) : (
              <Stack gap={1}>
                {filtered.map((fundraiser) => {
                  const alreadyAdded = addedIds.has(String(fundraiser.id));
                  return (
                    <Card
                      key={fundraiser.id}
                      padding={2}
                      radius={1}
                      tone={alreadyAdded ? "positive" : "default"}
                      style={{ cursor: alreadyAdded ? "default" : "pointer" }}
                      onClick={() => !alreadyAdded && addFundraiser(fundraiser)}
                    >
                      <Flex align="center" justify="space-between">
                        <Text size={1}>
                          {fundraiser.donor.name} <Text muted>({fundraiser.id})</Text>
                        </Text>
                        <Text size={1}>{alreadyAdded ? "Added ✓" : "+ Add"}</Text>
                      </Flex>
                    </Card>
                  );
                })}
              </Stack>
            )}
          </Box>
        </Stack>
      </Card>
    </Stack>
  );
};
