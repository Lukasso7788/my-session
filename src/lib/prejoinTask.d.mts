import type { SupabaseClient } from '@supabase/supabase-js';
export function savePrejoinTask(client: SupabaseClient, input: {userId: string; taskId: string; text: string}): Promise<null | {task: {id:string;text:string;completed:boolean;visibility:string;sort_order:number};order:string[]}>;

export function mergePrejoinHighlightedTask(text: string, tasks?: Array<{text:string;completed:boolean}>): Array<{text:string;completed:boolean}>;
