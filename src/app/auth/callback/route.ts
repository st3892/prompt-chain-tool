import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/?error=oauth", request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Unable to exchange the OAuth code for a session.", error);
    return NextResponse.redirect(new URL("/?error=oauth", request.url));
  }

  // The server client stores the exchanged session in Supabase auth cookies.
  return NextResponse.redirect(new URL("/dashboard", request.url));
}
