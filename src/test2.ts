import { supabase } from "./lib/supabase";

async function run() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .limit(1);

  console.log("Profiles test:", { data, error });
}

run();
