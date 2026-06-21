// Shared placeholder body for routes that exist in the nav but aren't built yet
// (Transactions, Payments, Milestones, AI Assistant). Centered "coming soon"
// message styled for the dark theme, so navigating to a stubbed route neither
// 404s nor looks broken.
//
// THROWAWAY: every page that renders this is an intentional stub to be replaced
// by a real page in a future phase. See src/app/CLAUDE.md ("Placeholder pages").

export default function ComingSoon({ title }: { title: string }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <span className="mb-3 rounded-full bg-brand-yellow/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-brand-yellow">
        Coming soon
      </span>
      <h1 className="text-2xl font-semibold text-text-primary-dark">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-text-secondary-dark">
        This section isn&apos;t built yet — it&apos;s a placeholder we&apos;ll
        replace with the real {title} page in a future phase.
      </p>
    </main>
  );
}
