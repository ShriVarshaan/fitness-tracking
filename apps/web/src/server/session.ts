import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * The verified user id for this request, or null. The proxy already blocks
 * signed-out requests; server actions and routes still check for themselves.
 */
export async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

export async function requireUserId(): Promise<string> {
  const id = await currentUserId();
  if (!id) throw new Error("Not signed in");
  return id;
}
