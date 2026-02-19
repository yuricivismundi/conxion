import { redirect } from "next/navigation";

type PageProps = {
  params: {
    connectionId?: string;
  };
};

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function MessageThreadRedirectPage({ params }: PageProps) {
  const raw = (params?.connectionId ?? "").trim();
  if (!raw) {
    redirect("/messages");
  }

  const token = encodeURIComponent(safeDecode(raw));
  redirect(`/messages?thread=${token}`);
}

