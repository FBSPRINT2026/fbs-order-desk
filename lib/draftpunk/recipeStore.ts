"use client";
/**
 * Saving recipes and their versions from the browser, one way everywhere (the editor, a brew's "make this the next
 * version", Import, the assistant, best-ever recipes, a photo of a book page). A recipe's data is its working copy;
 * every version is a frozen copy with its number and why.
 */
import { createClient } from "@/lib/supabase/client";
import { calcRecipe, calcSummary } from "./calc";
import type { Recipe } from "./types";
import { autoNote, diffRecipes } from "./versions";

export type Version = { id: string; recipe_id: string; num: number; note: string; data: Recipe; calc: Record<string, number | string>; made_on: string; from_brew: string | null; created_at: string };

export async function versionsOf(recipeId: string): Promise<Version[]> {
  const { data } = await createClient().from("dp_recipe_versions").select("*").eq("recipe_id", recipeId).order("num");
  return (data || []) as Version[];
}

/** a new recipe with its first version (or several, oldest first: an import of BeerSmith's copies) */
export async function createRecipe(userId: string, versions: { data: Recipe; note?: string; date?: string }[], extra: { status?: string; goal?: string; copied_from?: string } = {}): Promise<{ id?: string; error?: string }> {
  const sb = createClient();
  const last = versions[versions.length - 1].data;
  const { data, error } = await sb.from("dp_recipes").insert({ owner_id: userId, name: last.name || "Untitled", style_id: last.styleId || null, data: last, calc: calcSummary(calcRecipe(last)), ...extra }).select("id").single();
  if (error || !data) return { error: error?.message || "Not saved" };
  const rows = versions.map((v, i) => ({
    recipe_id: data.id, owner_id: userId, num: i + 1, data: v.data, calc: calcSummary(calcRecipe(v.data)), made_on: v.date || new Date().toISOString().slice(0, 10),
    note: v.note || (i === 0 ? "First version" : autoNote(diffRecipes(versions[i - 1].data, v.data))),
  }));
  const { error: e2 } = await sb.from("dp_recipe_versions").insert(rows);
  return e2 ? { id: data.id, error: e2.message } : { id: data.id };
}

/** the working copy becomes the next version (the editor's "Save as v5", a brew's "make this the next version") */
export async function saveVersion(recipeId: string, userId: string, data: Recipe, note: string, fromBrew?: string): Promise<{ version?: Version; error?: string }> {
  const sb = createClient();
  const prev = await versionsOf(recipeId);
  const last = prev[prev.length - 1];
  const num = (last?.num || 0) + 1;
  const { data: v, error } = await sb.from("dp_recipe_versions").insert({
    recipe_id: recipeId, owner_id: userId, num, data, calc: calcSummary(calcRecipe(data)), from_brew: fromBrew || null,
    note: note.trim() || (last ? autoNote(diffRecipes(last.data, data)) : "First version"),
  }).select("*").single();
  if (error) return { error: error.message };
  await sb.from("dp_recipes").update({ data, name: data.name, style_id: data.styleId || null, calc: calcSummary(calcRecipe(data)), updated_at: new Date().toISOString() }).eq("id", recipeId);
  return { version: v as Version };
}

/** the brewer's own first equipment profile, else the starter one (what a new recipe is built on) */
export async function myEquipment(userId: string) {
  const { DEFAULT_EQUIPMENT } = await import("./library");
  const { data } = await createClient().from("dp_equipment").select("name, data").eq("owner_id", userId).order("name").limit(1);
  const e = data?.[0];
  return e ? { ...(e.data as Recipe["equipment"]), name: e.name as string } : DEFAULT_EQUIPMENT[0];
}
