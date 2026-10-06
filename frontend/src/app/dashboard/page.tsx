import { redirect } from "next/navigation";

/**
 * The dashboard is a panel over the editor (DesignDB ▾ → Dashboard), not a page of its own — this address opens the
 * editor with the panel showing, so old links and bookmarks keep working.
 */
export default function DashboardPage({ searchParams }: { searchParams: { section?: string } }) {
  const section = searchParams.section === "recent" || searchParams.section === "templates" ? searchParams.section : "all";
  redirect(`/canvas?dashboard=${section}`);
}
