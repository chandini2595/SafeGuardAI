"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    : undefined;
const hasVoice = !!SpeechRecognitionAPI;

const MAX_IMAGE_SIZE = 1024;
const JPEG_QUALITY = 0.82;

function resizeAndCompressImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(w, h));
      const cw = Math.round(w * scale);
      const ch = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, cw, ch);
      try {
        const out = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        resolve(out);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

type Emergency = {
  police: string[];
  fire: string[];
  ambulance: string[];
  dispatch: string[];
};

type Result = {
  analysis: string;
  emergency: Emergency;
  countryCode: string;
  locationDisplay: string;
  googleMapsUrl?: string;
  safestPlace?: string | null;
  visionError?: string;
};

export default function Home() {
  const [image, setImage] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const [isSecureContext, setIsSecureContext] = useState(true);
  useEffect(() => {
    setIsSecureContext(typeof window !== "undefined" && window.isSecureContext);
  }, []);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const r = new FileReader();
    r.onload = () => setImage(r.result as string);
    r.readAsDataURL(file);
    setError(null);
    setResult(null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );
  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const f = e.clipboardData.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );
  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const startVoice = useCallback(() => {
    if (!SpeechRecognitionAPI) {
      setVoiceError("Voice input is not supported in this browser. Use Chrome or Edge.");
      return;
    }
    if (!isSecureContext) {
      setVoiceError(
        "Microphone is blocked on this connection. Use one of the options below to enable voice."
      );
      return;
    }
    setVoiceError(null);
    try {
      const Recognition = SpeechRecognitionAPI as new () => {
        start: () => void;
        stop: () => void;
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: (e: { results: Array<Array<{ transcript?: string }>> }) => void;
        onend: () => void;
        onerror: () => void;
      };
      let recognition = recognitionRef.current;
      if (!recognition) {
        const rec = new Recognition();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = "en-US";
        rec.onresult = (e) => {
          const transcript = e.results[0]?.[0]?.transcript?.trim();
          if (transcript) setLocation((prev) => (prev ? `${prev} ${transcript}` : transcript));
        };
        rec.onend = () => setIsListening(false);
        rec.onerror = () => setIsListening(false);
        recognitionRef.current = rec;
        recognition = rec;
      }
      recognition.start();
      setIsListening(true);
    } catch {
      setVoiceError("Could not start voice input.");
      setIsListening(false);
    }
  }, [isSecureContext]);

  const stopVoice = useCallback(() => {
    if (recognitionRef.current && isListening) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
    }
  }, [isListening]);

  const ANALYZE_TIMEOUT_MS = 90_000; // 90 seconds for vision APIs

  const submit = async () => {
    if (!image || !location.trim()) {
      setError("Please add an image and enter a location.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);
    try {
      const resized = await resizeAndCompressImage(image);
      const base64 = resized.replace(/^data:image\/\w+;base64,/, "");
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, location: location.trim() }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setResult(data);
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof Error && e.name === "AbortError") {
        setError("Request took too long. Try again or use a smaller image—vision can take up to a minute.");
      } else if (e instanceof Error && (e.message === "Failed to fetch" || e.name === "TypeError")) {
        setError(
          "Could not reach the server. Check: (1) Dev server is running (npm run dev). (2) If using HTTPS on another device, accept the certificate. (3) Same Wi‑Fi / network. Then try again."
        );
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  };

  const formatAnalysis = (text: string) => {
    const disaster = text.match(/DISASTER:\s*([^\n]+)/i)?.[1]?.trim() || "";
    let safest = text.match(/SAFEST_LOCATION:\s*([^\n]+(?:\n(?![A-Z_]+:)[^\n]*)*)/i)?.[1]?.trim() || text;
    // Remove raw placeholder text if the model included it in the output
    safest = safest.replace(/\s*SAFEST_PLACE:?\s*[^\n]*$/i, "").replace(/\s*SAFEST_PLACE\s*$/i, "").trim();
    return { disaster, safest };
  };

  return (
    <div className="min-h-screen bg-[#0c0f1a] text-slate-100">
      {/* Background graphics */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute top-1/2 -left-40 h-72 w-72 rounded-full bg-amber-500/5 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(14,165,233,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.03)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <div className="relative mx-auto max-w-xl px-4 py-12 sm:py-16">
        <header className="mb-12 text-center">
          <div className="inline-flex items-center justify-center rounded-2xl bg-sky-500/10 border border-sky-500/20 p-4 mb-6">
            <svg className="h-14 w-14 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl drop-shadow-sm">
            Safeguard
          </h1>
          <p className="mt-3 text-base text-slate-400 sm:text-lg max-w-md mx-auto">
            Paste a photo and your location. Get nearest safe spot and emergency numbers.
          </p>
        </header>

        <section className="mb-8">
          <div
            className="rounded-2xl border-2 border-dashed border-sky-500/30 bg-slate-800/50 p-10 text-center transition-all hover:border-sky-400/50 hover:bg-slate-800/60"
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onPaste={onPaste}
          >
            <input
              type="file"
              accept="image/*"
              onChange={onInputChange}
              className="hidden"
              id="img"
            />
            <label htmlFor="img" className="cursor-pointer block">
              {image ? (
                <img
                  src={image}
                  alt="Upload"
                  className="mx-auto max-h-72 w-full rounded-xl object-contain shadow-xl ring-1 ring-slate-600/50"
                />
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="rounded-2xl bg-gradient-to-br from-sky-500/20 to-amber-500/10 border border-sky-500/20 p-6">
                    <svg className="h-12 w-12 text-sky-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
                    </svg>
                    <div className="mt-2 flex justify-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-400/80" />
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400/80" />
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-400/80" />
                    </div>
                  </div>
                  <span className="text-slate-400 text-sm">
                    Drop an image, paste one, or click to upload
                  </span>
                </div>
              )}
            </label>
          </div>
        </section>

        <section className="mb-8">
          <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-400">
            <svg className="h-4 w-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Location
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="e.g. San Jose, CA or full address"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="flex-1 rounded-xl border border-slate-600 bg-slate-800/80 px-4 py-3.5 text-white placeholder-slate-500 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/25"
            />
            {hasVoice && (
              <button
                type="button"
                onClick={isListening ? stopVoice : startVoice}
                title={isListening ? "Stop listening" : "Speak location (for critical situations)"}
                className={`flex shrink-0 items-center justify-center rounded-xl px-4 py-3.5 transition ${
                  isListening
                    ? "bg-rose-600 text-white shadow-md shadow-rose-900/30 animate-pulse"
                    : "bg-slate-700 text-white hover:bg-slate-600 hover:text-sky-200"
                }`}
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0V8a5 5 0 0110 0v3z"
                  />
                </svg>
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Type or tap the mic to speak—use voice in critical situations when you can’t type.
          </p>
          {voiceError && (
            <p className="mt-2 text-xs text-amber-400">{voiceError}</p>
          )}
          {hasVoice && !isSecureContext && (
            <div className="mt-4 rounded-xl border border-amber-600/50 bg-amber-950/20 p-4 text-xs text-amber-200">
              <p className="font-medium">Microphone is blocked on this connection.</p>
              <p className="mt-2">To use voice location:</p>
              <ol className="mt-1 list-inside list-decimal space-y-1 text-amber-100/90">
                <li>
                  On this device, open <strong>http://localhost:3000</strong> instead (mic usually works there), or
                </li>
                <li>
                  Run <code className="rounded bg-slate-700/80 px-1.5 py-0.5">npm run dev:https</code> and open <strong>https://localhost:3000</strong> (accept the certificate once), or
                </li>
                <li>
                  In Chrome, go to <strong>chrome://flags/#unsafely-treat-insecure-origin-as-secure</strong>, add{" "}
                  <strong>{typeof window !== "undefined" ? window.location.origin : "this URL"}</strong>, then Relaunch.
                </li>
              </ol>
            </div>
          )}
          {isListening && (
            <p className="mt-2 text-xs text-rose-300">Listening… say your location now.</p>
          )}
        </section>

        <section className="mb-6">
          <button
            onClick={submit}
            disabled={loading}
            className="w-full rounded-xl bg-amber-500 px-5 py-4 font-semibold text-slate-900 shadow-lg shadow-amber-500/25 transition hover:bg-amber-400 hover:shadow-amber-500/30 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Analyzing image & finding safe place…</span>
              </>
            ) : (
              <>
                <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span>Get safe location & emergency numbers</span>
              </>
            )}
          </button>
          {loading && (
            <p className="mt-3 text-center text-xs text-slate-500">
              Vision AI can take 20–60 seconds. Using a smaller photo may speed it up.
            </p>
          )}
          {!loading && (
            <p className="mt-3 text-center text-xs text-slate-500">
              Analysis may take 20–60 sec: we run AI vision (image) then fetch your safe place & emergency numbers.
            </p>
          )}
        </section>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-3.5 text-sm text-red-200 flex items-start gap-3">
            <svg className="h-5 w-5 shrink-0 text-red-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="space-y-0 overflow-hidden rounded-2xl border border-sky-500/20 bg-slate-800/60 shadow-xl shadow-sky-900/10">
            {result.visionError && (
              <div className="border-b border-amber-600/40 bg-amber-950/25 px-5 py-3.5 text-sm text-amber-200 flex items-center gap-2">
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span><strong>Vision API:</strong> {result.visionError}</span>
              </div>
            )}
            <div className="border-b border-slate-600/50 px-5 py-5">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                <span className="rounded-lg bg-sky-500/20 p-1.5">
                  <svg className="h-3.5 w-3.5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </span>
                What we see
              </h2>
              <p className="mt-3 text-slate-100 leading-relaxed pl-8">
                {formatAnalysis(result.analysis).disaster || result.analysis}
              </p>
            </div>
            <div className="border-b border-slate-600/50 px-5 py-5">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                <span className="rounded-lg bg-sky-500/20 p-1.5">
                  <svg className="h-3.5 w-3.5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </span>
                Nearest safest location
              </h2>
              <p className="mt-3 font-medium text-sky-300 leading-relaxed pl-8">
                {formatAnalysis(result.analysis).safest}
              </p>
              {result.googleMapsUrl && (
                <div className="mt-4 space-y-2 pl-8">
                  {result.safestPlace && (
                    <p className="text-sm text-slate-400">
                      Nearest safe place: <span className="text-sky-300 font-medium">{result.safestPlace}</span>
                    </p>
                  )}
                  <a
                    href={result.googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl bg-sky-600/80 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500"
                  >
                    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span>Open in Google Maps</span>
                  </a>
                </div>
              )}
            </div>
            <div className="px-5 py-5">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                <span className="rounded-lg bg-amber-500/20 p-1.5">
                  <svg className="h-3.5 w-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </span>
                Emergency numbers
              </h2>
              <p className="mt-1 text-xs text-slate-500 pl-8">{result.locationDisplay}</p>
              <div className="mt-4 flex flex-wrap gap-3 pl-8">
                {(
                  [
                    ["Police", result.emergency.police],
                    ["Fire", result.emergency.fire],
                    ["Ambulance", result.emergency.ambulance],
                    ["Dispatch", result.emergency.dispatch],
                  ] as const
                ).map(([label, nums]) =>
                  nums.length ? (
                    <div key={label} className="rounded-xl bg-slate-700/80 px-4 py-2.5 shadow-inner border border-slate-600/50 flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-400">{label}</span>
                      <span className="font-mono text-sm font-semibold text-amber-300">
                        {nums.join(", ")}
                      </span>
                    </div>
                  ) : null
                )}
              </div>
              {(result.emergency.police.length === 0 &&
                result.emergency.dispatch.length === 0) && (
                <p className="mt-3 text-sm text-slate-500 pl-8">
                  No numbers for country code {result.countryCode}. Try a more specific location or check local emergency services.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
