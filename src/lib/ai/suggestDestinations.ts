export interface SuggestedDestination {
  title: string;
  location: string;
  description: string;
  costTier: "$" | "$$" | "$$$" | "$$$$";
}

const MOCK_SUGGESTIONS: SuggestedDestination[] = [
  {
    title: "Scottsdale Golf Getaway",
    location: "Scottsdale, AZ",
    description: "World-class desert courses with perfect winter weather and great nightlife.",
    costTier: "$$$",
  },
  {
    title: "Myrtle Beach Classic",
    location: "Myrtle Beach, SC",
    description: "Over 80 courses to choose from with affordable stay-and-play packages.",
    costTier: "$$",
  },
  {
    title: "Pinehurst Village",
    location: "Pinehurst, NC",
    description: "Historic resort with 9 championship courses and a laid-back Southern vibe.",
    costTier: "$$$",
  },
];

/**
 * Calls the Claude API to suggest 3 trip destinations based on a crew description.
 * Falls back to mock data when ANTHROPIC_API_KEY is not configured.
 * This runs server-side only (called from a Next.js API route).
 */
export async function suggestDestinations(
  crewDescription: string
): Promise<SuggestedDestination[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("ANTHROPIC_API_KEY is not set — returning mock suggestions");
    return MOCK_SUGGESTIONS;
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: `You are helping plan a group trip. Based on this crew description, suggest exactly 3 destination ideas.

Crew description: "${crewDescription}"

Respond with ONLY a JSON array, no other text, no markdown:
[
  {
    "title": "Short destination name",
    "location": "City, State/Country",
    "description": "One sentence why this fits the crew",
    "costTier": "$" | "$$" | "$$$" | "$$$$"
  }
]`,
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error("Claude API error:", response.status, await response.text());
    return [];
  }

  const data = await response.json();
  const text: string = data.content?.[0]?.text ?? "[]";
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 3);
  } catch {
    return [];
  }
}
