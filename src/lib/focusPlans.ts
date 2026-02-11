// src/lib/focusPlans.ts
import { supabase } from "./supabase";

export type FocusPlan = {
    id: string;
    user_id: string;
    title: string;
    created_at: string;
    updated_at: string;
};

export type FocusPlanItem = {
    id: string;
    plan_id: string;
    user_id: string;
    text: string;
    target_date: string | null; // YYYY-MM-DD
    session_id: string | null;
    created_at: string;
    completed: boolean;
    sort_order: number;
};

export async function listPlans() {
    const { data, error } = await supabase
        .from("focus_plans")
        .select("*")
        .order("updated_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as FocusPlan[];
}

export async function createPlan(title: string) {
    const { data, error } = await supabase
        .from("focus_plans")
        .insert({ title })
        .select("*")
        .single();

    if (error) throw error;
    return data as FocusPlan;
}

export async function updatePlanTitle(planId: string, title: string) {
    const { data, error } = await supabase
        .from("focus_plans")
        .update({ title })
        .eq("id", planId)
        .select("*")
        .single();

    if (error) throw error;
    return data as FocusPlan;
}

export async function deletePlan(planId: string) {
    const { error } = await supabase.from("focus_plans").delete().eq("id", planId);
    if (error) throw error;
}

export async function listPlanItems(planId: string) {
    const { data, error } = await supabase
        .from("focus_plan_items")
        .select("*")
        .eq("plan_id", planId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

    if (error) throw error;
    return (data ?? []) as FocusPlanItem[];
}

export async function addPlanItem(planId: string, payload: {
    text: string;
    target_date?: string | null; // YYYY-MM-DD
    session_id?: string | null;
    sort_order?: number;
}) {
    const { data, error } = await supabase
        .from("focus_plan_items")
        .insert({
            plan_id: planId,
            text: payload.text,
            target_date: payload.target_date ?? null,
            session_id: payload.session_id ?? null,
            sort_order: payload.sort_order ?? 0,
        })
        .select("*")
        .single();

    if (error) throw error;
    return data as FocusPlanItem;
}

export async function updatePlanItem(itemId: string, patch: Partial<Pick<
    FocusPlanItem,
    "text" | "target_date" | "session_id" | "completed" | "sort_order"
>>) {
    const { data, error } = await supabase
        .from("focus_plan_items")
        .update(patch)
        .eq("id", itemId)
        .select("*")
        .single();

    if (error) throw error;
    return data as FocusPlanItem;
}

export async function deletePlanItem(itemId: string) {
    const { error } = await supabase.from("focus_plan_items").delete().eq("id", itemId);
    if (error) throw error;
}
