import { supabase } from "./supabase";

export function getStoredReferralCode() {
  try {
    return localStorage.getItem("mysession_ref") || "";
  } catch {
    return "";
  }
}

export function storeReferralCodeFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = String(params.get("ref") || "").trim();

    if (ref) {
      localStorage.setItem("mysession_ref", ref);
      return ref;
    }

    return localStorage.getItem("mysession_ref") || "";
  } catch {
    return "";
  }
}

export async function ensureMyReferralCode(userId: string, fallbackName?: string) {
  const { data: existing } = await supabase
    .from("referral_codes")
    .select("id, code")
    .eq("owner_user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (existing?.code) return existing;

  const base =
    String(fallbackName || userId.slice(0, 8))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 18) || userId.slice(0, 8);

  const code = `${base}-${Math.random().toString(36).slice(2, 6)}`;

  const { data, error } = await supabase
    .from("referral_codes")
    .insert({
      owner_user_id: userId,
      code,
      type: "user",
      is_active: true,
    })
    .select("id, code")
    .single();

  if (error) throw error;
  return data;
}

export async function attachReferralToNewUser(referredUserId: string) {
  const code = getStoredReferralCode();
  if (!code || !referredUserId) return;

  const { data: referralCode } = await supabase
    .from("referral_codes")
    .select("id, owner_user_id, code")
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();

  if (!referralCode?.id) return;
  if (referralCode.owner_user_id === referredUserId) return;

  await supabase.from("referrals").insert({
    referrer_user_id: referralCode.owner_user_id,
    referred_user_id: referredUserId,
    referral_code_id: referralCode.id,
    source: "ref_link",
    status: "registered",
  });
}