import type { Provider } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { withTimeout } from "./promiseTimeout";

type StartOAuthOptions = {
  provider: Provider;
  redirectTo: string;
  scopes?: string;
};

export async function startOAuthRedirect({
  provider,
  redirectTo,
  scopes,
}: StartOAuthOptions) {
  const { data, error } = await withTimeout(
    supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        scopes,
        skipBrowserRedirect: true,
      },
    }),
    10_000,
    `Could not open ${provider} sign-in in time. Please try again.`
  );

  if (error) throw error;
  if (!data.url) throw new Error(`No ${provider} sign-in URL was returned.`);

  window.location.assign(data.url);
}
