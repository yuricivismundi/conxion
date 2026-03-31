import Nav from "@/components/Nav";
import ProfileMediaManager from "@/components/profile/ProfileMediaManager";

export default function EditProfileMediaPage() {
  return (
    <div className="min-h-screen bg-[#05080f] text-slate-100">
      <Nav />

      <main className="mx-auto max-w-[1180px] px-4 pb-28 pt-6 sm:px-6 lg:px-8">
        <ProfileMediaManager />
      </main>
    </div>
  );
}
