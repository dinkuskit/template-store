import type { APIRoute } from "astro";

import { isProofMutationEnabled } from "../../../features/store-shell/index.js";
import {
  readCapturedProofEmail,
  readCapturedProofLeads,
} from "../../../features/shopper-account/playground-runtime.js";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  if (!isProofMutationEnabled()) {
    return new Response("Not found", { status: 404 });
  }
  const email = url.searchParams.get("email")?.trim() ?? "";
  return Response.json({
    email: email ? readCapturedProofEmail(email) : null,
    leads: readCapturedProofLeads(),
  });
};
