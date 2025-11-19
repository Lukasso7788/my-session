import { supabase } from "./lib/supabase";

async function test() {
  const { data, error } = await supabase.from("profiles").select("*").limit(1);

  console.log("DATA:", data);
  console.log("ERROR:", error);
}

test();
