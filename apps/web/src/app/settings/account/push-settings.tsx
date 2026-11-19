"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { PUSH_KIND_LABEL, PUSH_KINDS } from "@/lib/push-rules";
import { removePushSubscription, savePushKinds, savePushSubscription, sendTestPush, type KindsState } from "./push-actions";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** "Chrome on Android" from the user agent, for the device list. */
function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

type Support = "checking" | "unsupported" | "ios-install" | "ok";

const button = "rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60";

export function PushSettings({ publicKey, kinds }: { publicKey: string | null; kinds: string[] }) {
  const [support, setSupport] = useState<Support>("checking");
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [kindState, saveKinds, savingKinds] = useActionState<KindsState, FormData>(savePushKinds, { status: "idle" });

  useEffect(() => {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      // iOS only offers push to apps added to the home screen.
      queueMicrotask(() => setSupport(ios && !standalone ? "ios-install" : "unsupported"));
      return;
    }
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => reg.pushManager.getSubscription())
      .then((s) => {
        setSub(s);
        setSupport("ok");
      })
      .catch(() => setSupport("unsupported"));
  }, []);

  if (!publicKey) return <p className="text-sm text-muted">Notifications aren&rsquo;t set up on this server yet.</p>;
  if (support === "checking") return <p className="text-sm text-muted">Checking this browser…</p>;
  if (support === "ios-install")
    return (
      <p className="text-sm text-muted">
        On iPhone and iPad, add this app to your home screen first (Share, then Add to Home Screen), open it from there and turn
        notifications on.
      </p>
    );
  if (support === "unsupported") return <p className="text-sm text-muted">This browser can&rsquo;t receive notifications.</p>;

  const enable = () =>
    start(async () => {
      setMessage(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setMessage("Notifications are blocked for this site. Allow them in your browser's site settings, then try again.");
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
        const res = await savePushSubscription({ ...JSON.parse(JSON.stringify(s)), device: deviceName() });
        if (!res.ok) {
          await s.unsubscribe();
          setMessage(res.message ?? "Couldn't turn notifications on.");
          return;
        }
        setSub(s);
        setMessage("Notifications are on for this device.");
      } catch {
        setMessage("Couldn't turn notifications on in this browser.");
      }
    });

  const disable = () =>
    start(async () => {
      if (!sub) return;
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await removePushSubscription(endpoint);
      setSub(null);
      setMessage("Notifications are off for this device.");
    });

  const test = () =>
    start(async () => {
      const res = await sendTestPush();
      setMessage(res.message);
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {sub ? (
          <>
            <button type="button" onClick={test} disabled={pending} className={`${button} bg-accent text-accent-fg`}>
              Send a test
            </button>
            <button type="button" onClick={disable} disabled={pending} className={`${button} border border-border`}>
              Turn off on this device
            </button>
          </>
        ) : (
          <button type="button" onClick={enable} disabled={pending} className={`${button} bg-accent text-accent-fg`}>
            {pending ? "Turning on…" : "Turn on for this device"}
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
      <form action={saveKinds} className="space-y-2">
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Send me</legend>
          {PUSH_KINDS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={k} defaultChecked={kinds.includes(k)} className="size-4 accent-[var(--accent)]" />
              {PUSH_KIND_LABEL[k]}
            </label>
          ))}
        </fieldset>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={savingKinds} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-60">
            Save
          </button>
          {kindState.message && <span className="text-sm text-muted">{kindState.message}</span>}
        </div>
      </form>
    </div>
  );
}
