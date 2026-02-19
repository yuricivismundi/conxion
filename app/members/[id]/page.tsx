import { redirect } from "next/navigation";

type Params = {
  params: Promise<{ id: string }>;
};

export default async function MembersProfileAlias({ params }: Params) {
  const { id } = await params;
  redirect(`/profile/${encodeURIComponent(id)}`);
}
