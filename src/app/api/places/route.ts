import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/places — proxy for Google Places Autocomplete (New API v1)
 * Keeps the API key server-side. Client sends { query, locationBias? }.
 *
 * Requires GOOGLE_PLACES_API_KEY in env.
 * Enable "Places API (New)" in Google Cloud Console.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Places API key not configured" },
      { status: 503 }
    );
  }

  const body = await req.json();
  const { query, locationBias } = body as {
    query: string;
    locationBias?: { lat: number; lng: number; radius?: number };
  };

  if (!query || query.length < 2) {
    return NextResponse.json({ predictions: [] });
  }

  // Use the new Places API (v1) autocomplete endpoint
  const requestBody: Record<string, unknown> = {
    input: query,
    includedPrimaryTypes: ["golf_course"],
    languageCode: "en",
  };

  // Bias results toward the trip's destination if provided
  if (locationBias) {
    requestBody.locationBias = {
      circle: {
        center: {
          latitude: locationBias.lat,
          longitude: locationBias.lng,
        },
        radius: locationBias.radius ?? 80000, // 80km default
      },
    };
  }

  try {
    const res = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Places API error:", res.status, errText);
      return NextResponse.json({ predictions: [] });
    }

    const data = await res.json();

    // Map to a simpler shape for the client
    const predictions = (data.suggestions ?? [])
      .filter((s: { placePrediction?: unknown }) => s.placePrediction)
      .map(
        (s: {
          placePrediction: {
            placeId: string;
            text: { text: string };
            structuredFormat?: {
              mainText: { text: string };
              secondaryText?: { text: string };
            };
          };
        }) => ({
          placeId: s.placePrediction.placeId,
          name:
            s.placePrediction.structuredFormat?.mainText.text ??
            s.placePrediction.text.text,
          description:
            s.placePrediction.structuredFormat?.secondaryText?.text ?? "",
          fullText: s.placePrediction.text.text,
        })
      );

    return NextResponse.json({ predictions });
  } catch (err) {
    console.error("Places API fetch error:", err);
    return NextResponse.json({ predictions: [] });
  }
}

/**
 * GET /api/places/details?placeId=xxx — fetch place details for a selected course
 */
export async function GET(req: NextRequest) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Places API key not configured" },
      { status: 503 }
    );
  }

  const placeId = req.nextUrl.searchParams.get("placeId");
  if (!placeId) {
    return NextResponse.json({ error: "placeId required" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "id,displayName,formattedAddress,location,googleMapsUri",
        },
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Place Details error:", res.status, errText);
      return NextResponse.json({ error: "Failed to fetch details" }, { status: 502 });
    }

    const data = await res.json();

    return NextResponse.json({
      placeId: data.id,
      name: data.displayName?.text ?? "",
      address: data.formattedAddress ?? "",
      lat: data.location?.latitude ?? null,
      lng: data.location?.longitude ?? null,
      mapsUrl: data.googleMapsUri ?? null,
    });
  } catch (err) {
    console.error("Place Details fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch details" }, { status: 502 });
  }
}
