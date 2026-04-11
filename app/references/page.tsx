import { redirect } from "next/navigation";

type ReferencesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function pickFirst(val: string | string[] | undefined): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val[0] ?? "";
  return "";
}

export default async function ReferencesPage({ searchParams }: ReferencesPageProps) {
  const resolved = searchParams ? await searchParams : {};
  const params = new URLSearchParams({ tab: "references" });

  const normalizedConnectionId = pickFirst(resolved.connectionId);
  if (normalizedConnectionId) {
    params.set("connectionId", normalizedConnectionId);
  }

  const normalizedUserId = pickFirst(resolved.userId);
  if (normalizedUserId) {
    params.set("userId", normalizedUserId);
  }

  redirect(`/network?${params.toString()}`);
}
