import { supabase } from "./lib/supabase";

async function run() {
    console.log("Supabase Test");

    const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .limit(1);

    console.log({ data, error });
}

run();
