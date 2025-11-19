import { supabase } from "../lib/supabase";

async function test() {
  const { data, error } = await supabase.from("profiles").select("*").limit(1);

  console.log("TEST DATA:", data);
  console.log("TEST ERROR:", error);
}

test();
