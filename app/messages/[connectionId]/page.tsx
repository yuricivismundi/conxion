import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{
    connectionId?: string;
  }>;
};

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function MessageThreadRedirectPage({ params }: PageProps) {
  const resolvedParams = await params;
  const raw = (resolvedParams?.connectionId ?? "").trim();
  if (!raw) {
    redirect("/messages");
  }

  const token = encodeURIComponent(safeDecode(raw));
  redirect(`/messages?thread=${token}&mobile=1`);
}
