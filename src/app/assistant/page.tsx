// THROWAWAY STUB — not a forgotten page. AI Assistant is in the nav but not yet
// built; this placeholder keeps the route at 200 instead of 404. Replace with
// the real page in a future phase. See src/app/CLAUDE.md ("Placeholder pages").
//
// Static content (no DB/date reads), so it intentionally opts OUT of the app's
// default `dynamic = "force-dynamic"` — see src/app/CLAUDE.md frontend rule 6.

import ComingSoon from "../_components/ComingSoon";

export default function AssistantPage() {
  return <ComingSoon title="AI Assistant" />;
}
