import { NextRequest, NextResponse } from "next/server";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const NEMOTRON_MODEL =
  process.env.OPENROUTER_VISION_MODEL || "nvidia/nemotron-nano-12b-v2-vl";
// Fallback when Nemotron returns empty. :free endpoint was discontinued; use paid Gemini (uses OpenRouter credits).
const FALLBACK_VISION_MODEL = "google/gemini-2.0-flash-exp";

const PROMPT = (location: string) =>
  `You are an emergency safety assistant. The user is at: "${location}".

Look at this image and:
1. Describe what you see in 1-2 sentences (e.g. wildfire, flood, storm).
2. Give a short recommendation (SAFEST_LOCATION): what to do or where to go.
3. SAFEST_PLACE: Give ONE specific place name we can search on Google Maps. This must be ONLY a place name or address—e.g. "El Dorado County Fairgrounds", "Placerville evacuation shelter", "Red Cross shelter Placerville", "Cameron Park evacuation center"—NOT a sentence like "Evacuate to..." or "Seek shelter at...". Pick a realistic type of evacuation shelter or safe location for the area.

Reply in this exact format with all three lines:
DISASTER: [your description]
SAFEST_LOCATION: [short recommendation]
SAFEST_PLACE: [only the place name, no full sentence]`;

const VISION_TIMEOUT_MS = 55_000; // per model (Nemotron then fallback)

async function callVision(
  apiKey: string,
  model: string,
  imageUrl: string,
  location: string
): Promise<{ analysis: string; visionError?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer":
          process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT(location) },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 400,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const body = await res.text();
    if (!res.ok) {
      let errMsg = "";
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
        errMsg = parsed?.error?.message || parsed?.message || body.slice(0, 280);
      } catch {
        errMsg = body.slice(0, 280) || `HTTP ${res.status}`;
      }
      return { analysis: "", visionError: errMsg };
    }
    let data: {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
      }>;
      error?: { message?: string };
    };
    try {
      data = JSON.parse(body);
    } catch {
      return { analysis: "" };
    }
    if (data?.error?.message) {
      return { analysis: "", visionError: data.error.message };
    }
    const raw = data?.choices?.[0]?.message?.content;
    const analysis = (
      typeof raw === "string"
        ? raw
        : Array.isArray(raw)
          ? raw.map((c) => (c?.type === "text" ? c?.text : "")).join("")
          : ""
    ).trim();
    return { analysis };
  } catch (e) {
    clearTimeout(timeoutId);
    const errMsg = e instanceof Error ? e.message : "Vision request failed";
    return { analysis: "", visionError: errMsg };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, location } = (await req.json()) as {
      imageBase64: string;
      location: string;
    };

    if (!imageBase64 || !location?.trim()) {
      return NextResponse.json(
        { error: "Missing image or location" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY not set. Add it in .env.local" },
        { status: 500 }
      );
    }

    // 1) Geocode location → country code for emergency numbers
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        location.trim()
      )}&format=json&limit=1`,
      { headers: { "User-Agent": "SafeguardAI-Hackathon/1.0" } }
    );
    const geoJson = (await geoRes.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
      address?: { country_code?: string };
    }>;
    let countryCode = geoJson[0]?.address?.country_code?.toUpperCase();
    if (!countryCode && geoJson[0]) {
      const rev = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${geoJson[0].lat}&lon=${geoJson[0].lon}&format=json`,
        { headers: { "User-Agent": "SafeguardAI-Hackathon/1.0" } }
      );
      const revJson = (await rev.json()) as { address?: { country_code?: string } };
      countryCode = revJson?.address?.country_code?.toUpperCase();
    }
    countryCode = countryCode || "US";

    // 2) Fetch emergency numbers for country
    let emergency: {
      police: string[];
      fire: string[];
      ambulance: string[];
      dispatch: string[];
    } = { police: [], fire: [], ambulance: [], dispatch: [] };
    try {
      const emergencyRes = await fetch(
        `https://emergencynumberapi.com/api/country/${countryCode}`
      );
      const emergencyJson = (await emergencyRes.json()) as {
        data?: {
          police?: { all?: string[]; All?: string[] };
          fire?: { all?: string[]; All?: string[] };
          ambulance?: { all?: string[]; All?: string[] };
          dispatch?: { all?: string[]; All?: string[] };
          Police?: { All?: string[] };
          Fire?: { All?: string[] };
          Ambulance?: { All?: string[] };
          Dispatch?: { All?: string[] };
        };
      };
      const d = emergencyJson?.data;
      if (d) {
        const arr = (o: { all?: string[]; All?: string[] } | undefined) =>
          (o?.all ?? o?.All ?? []).filter((n) => n != null && n !== "");
        emergency = {
          police: arr(d.police ?? d.Police),
          fire: arr(d.fire ?? d.Fire),
          ambulance: arr(d.ambulance ?? d.Ambulance),
          dispatch: arr(d.dispatch ?? d.Dispatch),
        };
      }
    } catch {
      // keep default empty
    }

    // 3) Vision: Nemotron first (for hackathon), then Gemini fallback if empty. Set OPENROUTER_FAST_VISION=1 to use only Gemini (faster).
    const imageUrl = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const useFastVision = process.env.OPENROUTER_FAST_VISION === "1" || process.env.OPENROUTER_FAST_VISION === "true";
    let analysis = "";
    let visionError: string | undefined;
    const r1 = useFastVision
      ? await callVision(apiKey, FALLBACK_VISION_MODEL, imageUrl, location)
      : await callVision(apiKey, NEMOTRON_MODEL, imageUrl, location);
    analysis = r1.analysis;
    visionError = r1.visionError;
    if (!analysis && !useFastVision) {
      const r2 = await callVision(apiKey, FALLBACK_VISION_MODEL, imageUrl, location);
      analysis = r2.analysis;
      if (!visionError) visionError = r2.visionError;
    }
    if (!analysis) {
      analysis =
        "Unable to analyze image. Try a clear photo and check your OpenRouter key.";
    }

    const locationDisplay = geoJson[0]?.display_name || location;
    const safestMatch = analysis.match(/SAFEST_LOCATION:\s*([^\n]+(?:\n(?![A-Z_]+:)[^\n]*)*)/i);
    const safestText = safestMatch?.[1]?.trim() || analysis;
    // Use the specific place the AI named for Maps (so "Open in Maps" shows that place, not fire stations)
    const safestPlaceMatch = analysis.match(/SAFEST_PLACE:\s*([^\n]+)/i);
    let mapsQuery = safestPlaceMatch?.[1]?.trim() || "";
    const useSpecificPlace =
      mapsQuery.length > 0 &&
      mapsQuery.length <= 80 &&
      !/^(evacuate|move|seek|go|get to|head|stay)/i.test(mapsQuery);
    if (!useSpecificPlace) {
      const disasterLine = analysis.match(/DISASTER:\s*([^\n]+)/i)?.[1]?.trim() || "";
      const isFire = /\bfire\b|\bwildfire\b|\bflame\b/i.test(disasterLine);
      const isFlood = /\bflood\b|\bwater\b|\btsunami\b/i.test(disasterLine);
      const isStorm = /\bstorm\b|\bhurricane\b|\btornado\b/i.test(disasterLine);
      const placeType = isFire
        ? "evacuation shelter"
        : isFlood
          ? "evacuation shelter"
          : isStorm
            ? "emergency shelter"
            : "evacuation shelter";
      mapsQuery = `${placeType} ${locationDisplay}`.trim();
    }
    // When we have a specific place (e.g. "El Dorado County Fairgrounds"), search only that—don't append the full location string
    const googleMapsUrl = mapsQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
      : undefined;

    return NextResponse.json({
      analysis,
      emergency,
      countryCode,
      locationDisplay,
      googleMapsUrl,
      safestPlace: useSpecificPlace ? (safestPlaceMatch?.[1]?.trim() || null) : null,
      ...(visionError ? { visionError } : {}),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Analysis failed" },
      { status: 500 }
    );
  }
}
