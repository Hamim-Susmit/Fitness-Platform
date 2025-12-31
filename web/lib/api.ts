import { supabaseBrowser } from "./supabase-browser";

type FunctionResponse<T> = {
  data: T | null;
  error: string | null;
};

export async function callEdgeFunction<T>(
  name: string,
  options?: { body?: Record<string, unknown> }
): Promise<FunctionResponse<T>> {
  const { data, error } = await supabaseBrowser.functions.invoke(name, {
    body: options?.body,
  });

  if (error) {
    return { data: null, error: error.message ?? "Edge function call failed" };
  }

  return { data: data as T, error: null };
}
