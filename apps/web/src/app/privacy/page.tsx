import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PRIVACY_VERSION } from "@/lib/privacy";

export const metadata: Metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-10">
      <Link href="/" className="text-sm text-muted underline">
        ← Back
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Privacy notice</h1>
        <p className="text-sm text-muted">Version {PRIVACY_VERSION}</p>
      </div>

      <Section title="Who runs this">
        This is a personal, non-commercial project run by an individual developer. It is a portfolio project, not a
        company or a medical service. As the person who runs the server, the developer can technically access the
        database; data is only accessed to operate and fix the app.
      </Section>

      <Section title="What is stored">
        Your email address and a hashed password (handled by Supabase Auth). If you connect Garmin: your Garmin Personal
        API key (encrypted in Supabase Vault) and the data Garmin returns — daily summaries (steps, heart rate, stress,
        Body Battery, pulse ox, respiration), sleep, HRV, VO2 max, weight and activities, including each activity&rsquo;s
        original file (second-by-second heart rate, pace, power, laps, strength sets and GPS route). Your name and profile
        picture are not stored, and route points within 200 m of an activity&rsquo;s start and finish are removed before
        storage. Estimates this app calculates from your data are stored alongside it.
      </Section>

      <Section title="Why, and the legal basis">
        To show you your own training and recovery data and estimates. Health data is special category data under UK
        GDPR; it is processed only with your explicit consent, given when you create an account. You can withdraw it at
        any time by deleting your account.
      </Section>

      <Section title="Who processes it">
        Supabase (database, login and encryption, hosted in Frankfurt, EU) and Vercel (hosting; your data passes through
        its servers when pages load). Garmin provides your data under its own terms when you add your key. Activity maps load map images from OpenFreeMap, which sees which map area your browser shows but not your data. No analytics
        or advertising services are used. If an optional AI feature is added later, it will be off by default and ask
        for separate consent first.
      </Section>

      <Section title="Who can see it">
        Only you. Every table is protected so each account can read only its own rows. Your data is never shared with
        other users.
      </Section>

      <Section title="How long it is kept">
        Raw responses from Garmin are kept up to 30 days for troubleshooting. Everything else is kept until you remove
        your Garmin key, delete your data, or delete your account.
      </Section>

      <Section title="Your rights">
        On the Account page you can download all of your data and delete your account, which permanently removes your
        login, your Garmin key and all of your data. You can also ask the UK Information Commissioner&rsquo;s Office
        (ico.org.uk) about how your data is handled.
      </Section>

      <Section title="Not medical advice">
        This app gives general wellness information. It is not a medical device and does not diagnose anything. If you
        are worried about your health, contact your GP or NHS 111, or call 999 in an emergency.
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h2 className="font-medium">{title}</h2>
      <p className="text-sm leading-relaxed text-muted">{children}</p>
    </section>
  );
}
