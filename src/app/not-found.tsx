import Link from "next/link";

export default function NotFound() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center"
      style={{ background: "#0d1117", color: "#e6edf3" }}
    >
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full text-3xl font-bold"
        style={{ background: "#161b22", color: "#00d4aa" }}
      >
        404
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold" style={{ color: "#e6edf3" }}>
          Page not found
        </h1>
        <p className="max-w-xs text-sm" style={{ color: "#8b949e" }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
      </div>

      <Link
        href="/dashboard"
        className="rounded-xl px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
        style={{ background: "#00d4aa", color: "#0d1117" }}
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
