"use client";
/* eslint-disable @next/next/no-img-element */

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import EventCoverCropDialog from "@/components/events/EventCoverCropDialog";
import { PRIVATE_GROUP_CHAT_MODE_OPTIONS, type EventChatMode } from "@/lib/events/access";
import { validateEventCoverSourceFile } from "@/lib/events/cover-upload";
import { supabase } from "@/lib/supabase/client";

const MIN_TITLE_LENGTH = 8;
const MAX_TITLE_LENGTH = 50;
const MIN_DESCRIPTION_LENGTH = 24;
const MAX_DESCRIPTION_LENGTH = 4000;

export default function EditGroupPage() {
  return (
    <Suspense>
      <EditGroupForm />
    </Suspense>
  );
}

function EditGroupForm() {
  const { id: groupId } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);

  // Form fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [chatMode, setChatMode] = useState<EventChatMode>("discussion");
  const [coverUrl, setCoverUrl] = useState("");
  const [pendingCoverFile, setPendingCoverFile] = useState<File | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr || !authData.user) { router.replace("/auth"); return; }
        const userId = authData.user.id;
        setMeId(userId);
        const { data: sessionData } = await supabase.auth.getSession();
        if (cancelled) return;
        setAccessToken(sessionData.session?.access_token ?? null);

        // Load group data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabase as any;
        const { data: groupData, error: groupErr } = await db.from("groups").select("*").eq("id", groupId).single();
        if (cancelled) return;
        if (groupErr || !groupData) {
          router.replace("/activity?tab=groups");
          return;
        }
        if (groupData.host_user_id !== userId) {
          router.replace("/activity?tab=groups");
          return;
        }

        setTitle(groupData.title ?? "");
        setDescription(groupData.description ?? "");
        setChatMode(groupData.chat_mode === "broadcast" ? "broadcast" : "discussion");
        setCoverUrl(groupData.cover_url ?? "");
      } catch {
        if (!cancelled) setError("Could not load group.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId, router]);

  async function onPickCover(file: File | null) {
    if (!file || !meId) return;
    setError(null);
    try {
      validateEventCoverSourceFile(file);
      setPendingCoverFile(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cover upload failed.");
    }
  }

  async function uploadPreparedCover(preparedFile: File) {
    if (!meId) throw new Error("Missing user session.");
    setError(null);
    setUploadingCover(true);
    try {
      if (!accessToken) throw new Error("Missing auth session. Please sign in again.");
      const formData = new FormData();
      formData.append("file", preparedFile);
      formData.append("prefix", "group-cover");
      const res = await fetch("/api/uploads/cover", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });
      const json = (await res.json()) as { ok: boolean; url?: string; error?: string };
      if (!json.ok || !json.url) throw new Error(json.error ?? "Cover upload failed.");
      setCoverUrl(json.url);
      setPendingCoverFile(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Cover upload failed.";
      setError(msg);
      throw e instanceof Error ? e : new Error(msg);
    } finally {
      setUploadingCover(false);
    }
  }

  async function handleSave() {
    if (!accessToken) { setError("Missing auth session."); return; }
    if (uploadingCover) { setError("Please wait for cover upload to finish."); return; }
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (trimmedTitle.length < MIN_TITLE_LENGTH) { setError(`Title must be at least ${MIN_TITLE_LENGTH} characters.`); return; }
    if (trimmedTitle.length > MAX_TITLE_LENGTH) { setError(`Title must be no more than ${MAX_TITLE_LENGTH} characters.`); return; }
    if (trimmedDescription.length < MIN_DESCRIPTION_LENGTH) { setError(`Description must be at least ${MIN_DESCRIPTION_LENGTH} characters.`); return; }
    if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) { setError(`Description must be no more than ${MAX_DESCRIPTION_LENGTH} characters.`); return; }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          title: trimmedTitle,
          description: trimmedDescription,
          chatMode,
          coverUrl: coverUrl.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Failed to save changes.");
        setSubmitting(false);
        return;
      }
      router.push(`/groups/${groupId}`);
    } catch {
      setError("Could not save changes. Check your connection.");
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!accessToken) { setError("Missing auth session."); return; }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Failed to delete group.");
        setDeleting(false);
        setDeleteConfirmOpen(false);
        return;
      }
      router.push("/activity?tab=groups");
    } catch {
      setError("Could not delete group. Check your connection.");
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070c] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[780px] px-4 pb-24 pt-7 sm:px-6">
          <div className="animate-pulse space-y-5">
            <div className="h-16 rounded-2xl bg-white/[0.04]" />
            <div className="h-[500px] rounded-3xl bg-white/[0.04]" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05070c] text-slate-100">
      <Nav />

      {pendingCoverFile ? (
        <EventCoverCropDialog
          file={pendingCoverFile}
          onConfirm={(prepared) => void uploadPreparedCover(prepared)}
          onClose={() => setPendingCoverFile(null)}
        />
      ) : null}

      {/* Delete confirmation dialog */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[28px] border border-white/10 bg-[#0a0c13] p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Delete group?</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              This will permanently delete the group and archive its chat thread. This cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleting}
                className="flex-1 rounded-full border border-white/15 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-white/30 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="flex-1 rounded-full bg-rose-600 py-2.5 text-sm font-bold text-white transition hover:bg-rose-500 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete group"}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-[640px] px-4 pb-14 pt-7 sm:px-6">
        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#14161c] shadow-[0_28px_80px_rgba(0,0,0,0.5)]">
          {/* Header row */}
          <div className="flex items-center justify-between px-5 py-4">
            <h1 className="text-xl font-bold text-white">Edit Group</h1>
            <button
              type="button"
              onClick={() => router.back()}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-slate-300 hover:bg-white/20"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          {/* Cover — flush, full-width */}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { void onPickCover(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }}
          />
          {coverUrl ? (
            <div className="relative h-52 bg-black sm:h-64">
              <img src={coverUrl} alt="Group cover" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              <div className="absolute bottom-4 left-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur-sm hover:bg-black/85"
                >
                  <span className="material-symbols-outlined text-[16px]">add_photo_alternate</span>
                  {uploadingCover ? "Uploading..." : "Change photo"}
                </button>
                <button
                  type="button"
                  onClick={() => setCoverUrl("")}
                  className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur-sm hover:bg-black/85"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 bg-[#1e2028] text-center hover:bg-[#22242c]"
            >
              <span className="material-symbols-outlined text-[36px] text-slate-400">add_photo_alternate</span>
              <p className="text-sm font-semibold text-slate-300">{uploadingCover ? "Uploading..." : "Add cover photo"}</p>
            </button>
          )}

          {/* Form body */}
          <div className="space-y-5 px-5 py-6">
            {/* Name */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">Group Details</h2>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Group Name <span className="text-rose-400">*</span></span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE_LENGTH))}
                  placeholder="e.g. Barcelona bachata practice group"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
                <div className="flex justify-between text-xs">
                  <span className={title.trim().length > 0 && title.trim().length < MIN_TITLE_LENGTH ? "text-amber-300" : "text-slate-500"}>
                    {title.trim().length > 0 && title.trim().length < MIN_TITLE_LENGTH ? `Min ${MIN_TITLE_LENGTH} chars` : ""}
                  </span>
                  <span className={title.length > MAX_TITLE_LENGTH ? "text-rose-400" : "text-slate-500"}>{title.length}/{MAX_TITLE_LENGTH}</span>
                </div>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Description <span className="text-rose-400">*</span></span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
                  rows={5}
                  placeholder="Describe what this group is about, who it's for, and what members can expect..."
                  className="w-full resize-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
                <div className="flex justify-between text-xs">
                  <span className={description.trim().length > 0 && description.trim().length < MIN_DESCRIPTION_LENGTH ? "text-amber-300" : "text-slate-500"}>
                    {description.trim().length > 0 && description.trim().length < MIN_DESCRIPTION_LENGTH ? `Min ${MIN_DESCRIPTION_LENGTH} chars` : ""}
                  </span>
                  <span className={description.length > MAX_DESCRIPTION_LENGTH ? "text-rose-400" : "text-slate-500"}>{description.length}/{MAX_DESCRIPTION_LENGTH}</span>
                </div>
              </label>
            </section>

            {/* Chat Mode */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">Chat Mode</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {PRIVATE_GROUP_CHAT_MODE_OPTIONS.map((option) => {
                  const selected = chatMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setChatMode(option.value)}
                      className={`rounded-2xl border px-5 py-4 text-left transition ${
                        selected
                          ? "border-cyan-300/30 bg-[linear-gradient(135deg,rgba(0,245,255,0.08),rgba(217,70,239,0.06))] text-white"
                          : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      <p className="text-sm font-bold text-white">{option.label}</p>
                      <p className="mt-1 text-xs text-slate-400">{option.helper}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Delete group */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(true)}
                className="w-full rounded-full border border-rose-400/25 bg-rose-500/[0.06] py-2.5 text-sm font-bold text-rose-400 transition hover:bg-rose-500/12"
              >
                Delete group
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-white/10 px-5 py-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="text-sm font-semibold text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={submitting || uploadingCover}
              className="rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-400 px-7 py-2.5 text-sm font-bold text-[#052328] hover:opacity-95 disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
