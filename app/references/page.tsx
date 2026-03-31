import { redirect } from "next/navigation";

type ReferencesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReferencesPage({ searchParams }: ReferencesPageProps) {
  const resolved = searchParams ? await searchParams : {};
  const params = new URLSearchParams({ tab: "references" });

  const connectionId = resolved.connectionId;
  const normalizedConnectionId =
    typeof connectionId === "string" ? connectionId : Array.isArray(connectionId) ? connectionId[0] ?? "" : "";
  if (normalizedConnectionId) {
    params.set("connectionId", normalizedConnectionId);
  }

  redirect(`/network?${params.toString()}`);
}
