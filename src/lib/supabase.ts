
import { createBrowserClient } from "@supabase/ssr";

// Connect to our existing Supabase project.
// The publishable key is safe to use in the browser.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);
