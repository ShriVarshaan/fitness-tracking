import { ImageResponse } from "next/og";

const SIZES = { "192.png": 192, "512.png": 512, "180.png": 180 } as const;

export const dynamic = "force-static";
export function generateStaticParams() {
  return Object.keys(SIZES).map((file) => ({ file }));
}

/** App icons for the web app manifest and home screens: a heart-rate trace on the accent colour. */
export async function GET(_req: Request, ctx: RouteContext<"/icons/[file]">) {
  const { file } = await ctx.params;
  const size = SIZES[file as keyof typeof SIZES];
  if (!size) return new Response("Not found", { status: 404 });
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1f6f5c" }}>
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12h4l2.5-6 4 12 3-9 2 3H22" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
