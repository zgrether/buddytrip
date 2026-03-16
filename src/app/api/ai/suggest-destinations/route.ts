import { NextRequest, NextResponse } from "next/server";
import { suggestDestinations } from "@/lib/ai/suggestDestinations";
import { createClient } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  // Verify the user is authenticated
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const crewDescription = body?.crewDescription;

  if (!crewDescription || typeof crewDescription !== "string") {
    return NextResponse.json(
      { error: "crewDescription is required" },
      { status: 400 }
    );
  }

  const suggestions = await suggestDestinations(crewDescription.trim());
  return NextResponse.json({ suggestions });
}
