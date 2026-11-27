import { NextApiRequest, NextApiResponse } from "next";
import { DateTime } from "luxon";
import {
  PledgeForm,
  PledgeSettings,
  buildPledgeRequest,
  validatePledgeForm,
} from "../../components/main/blocks/PledgeSignup/pledgeRequest";

/**
 * POST /api/pledge: the pledge signup block's form. Signs the pledge at Giving What We Can
 * (PUT /v1/pledges/sign), whose credentials must stay on the server.
 *
 * Not connected to GWWC yet: in development it logs the request it would send and answers ok;
 * anywhere else it answers 503, so a deployed form never pretends a pledge went through.
 */
export default async function pledge(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const form = req.body?.form as PledgeForm | undefined;
  const settings = req.body?.settings as PledgeSettings | undefined;
  if (!form || !settings?.clubName) {
    return res.status(400).json({ error: "Missing form or club name" });
  }
  const errors = validatePledgeForm(form);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: "Invalid form", fields: errors });
  }

  const body = buildPledgeRequest(form, settings, DateTime.now().toISODate()!);

  if (process.env.NODE_ENV === "development") {
    console.log("[pledge] dry run, would PUT /v1/pledges/sign:", JSON.stringify(body, null, 2));
    return res.status(200).json({ status: "dry_run" });
  }
  return res.status(503).json({ error: "Pledge signing is not connected yet" });
}
