import { createClient } from "@/lib/supabase/server";

export async function getSuperadminClient() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError) {
    console.error("Unable to verify the current user.", authError);
    return {
      authorized: false,
      error: "We could not verify your sign-in. Please sign in again.",
    } as const;
  }

  if (!user) {
    return {
      authorized: false,
      error: "Please sign in before managing prompt chains.",
    } as const;
  }

  // Recheck the user's admin role for every protected server operation.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_superadmin")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Unable to verify the user's admin profile.", profileError);
    return {
      authorized: false,
      error: "We could not verify your admin access. Please contact your project administrator.",
    } as const;
  }

  if (profile?.is_superadmin !== true) {
    return {
      authorized: false,
      error: "Only superadmins can manage prompt chains.",
    } as const;
  }

  return { authorized: true, supabase } as const;
}

export function getDatabaseErrorMessage(
  error: { code?: string; message: string },
  table = "prompt_chains",
) {
  if (
    error.code === "42501" ||
    error.message.toLowerCase().includes("row-level security")
  ) {
    return `Supabase Row Level Security denied this action. Check that ${table} has a policy allowing superadmins to perform this operation.`;
  }

  return `Database request failed: ${error.message}`;
}
