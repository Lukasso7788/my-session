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

function assertUserId(userId?: string | null) {
    const uid = String(userId || "").trim();
    if (!uid) throw new Error("Not authenticated (missing userId)");
    return uid;
}

export async function listPlans(userId: string) {
    const uid = assertUserId(userId);

    const { data, error } = await supabase
        .from("focus_plans")
        .select("*")
        .eq("user_id", uid)
        .order("updated_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as FocusPlan[];
}

export async function createPlan(userId: string, title: string) {
    const uid = assertUserId(userId);

    const { data, error } = await supabase
        .from("focus_plans")
        .insert({ user_id: uid, title })
        .select("*")
        .single();

    if (error) throw error;
    return data as FocusPlan;
}

export async function updatePlanTitle(userId: string, planId: string, title: string) {
    const uid = assertUserId(userId);

    const { data, error } = await supabase
        .from("focus_plans")
        .update({ title })
        .eq("id", planId)
        .eq("user_id", uid)
        .select("*")
        .single();

    if (error) throw error;
    return data as FocusPlan;
}

export async function deletePlan(userId: string, planId: string) {
    const uid = assertUserId(userId);

    const { error } = await supabase
        .from("focus_plans")
        .delete()
        .eq("id", planId)
        .eq("user_id", uid);

    if (error) throw error;
}

export async function listPlanItems(userId: string, planId: string) {
    const uid = assertUserId(userId);

    const { data, error } = await supabase
        .from("focus_plan_items")
        .select("*")
        .eq("plan_id", planId)
        .eq("user_id", uid)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

    if (error) throw error;
    return (data ?? []) as FocusPlanItem[];
}

export async function addPlanItem(
    userId: string,
    planId: string,
    payload: {
        text: string;
        target_date?: string | null; // YYYY-MM-DD
        session_id?: string | null;
        sort_order?: number;
    }
) {
    const uid = assertUserId(userId);

    const { data, error } = await supabase
        .from("focus_plan_items")
        .insert({
            user_id: uid,
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

export async function updatePlanItem(
    userId: string,
    itemId: string,
    patch: Partial<Pick<FocusPlanItem, "text" | "target_date" | "session_id" | "completed" | "sort_order">>
) {
    const uid = assertUserId(userId);

    const { data, error } = await supabase
        .from("focus_plan_items")
        .update(patch)
        .eq("id", itemId)
        .eq("user_id", uid)
        .select("*")
        .single();

    if (error) throw error;
    return data as FocusPlanItem;
}

export async function deletePlanItem(userId: string, itemId: string) {
    const uid = assertUserId(userId);

    const { error } = await supabase
        .from("focus_plan_items")
        .delete()
        .eq("id", itemId)
        .eq("user_id", uid);

    if (error) throw error;
}
