import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeCountryCode(value: unknown) {
  const country = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : "";

    if (!token) {
      return res.status(401).json({ error: "Missing Authorization bearer token" });
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Vercel adds this trusted request header at the edge. Do not accept a
    // country value from the JSON body, otherwise clients could spoof it.
    const countryCode = normalizeCountryCode(req.headers["x-vercel-ip-country"]);

    if (!countryCode) {
      return res.status(200).json({ captured: false });
    }

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        country_code: countryCode,
        country_detected_at: nowIso,
        location_source: "vercel_ip_country",
      })
      .eq("id", user.id);

    if (updateError) throw updateError;

    return res.status(200).json({ captured: true });
  } catch (error) {
    console.error("[profile/location] failed", error);
    return res.status(500).json({ error: "Failed to capture profile location" });
  }
}
