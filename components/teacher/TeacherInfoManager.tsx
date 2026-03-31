"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";
import { fetchTeacherInfoBlocks, fetchTeacherInfoProfile } from "@/lib/teacher-info/read-model";
import { canManageTeacherInfo } from "@/lib/teacher-info/roles";
import {
  getTeacherInfoAttachment,
  getTeacherInfoTemplateText,
  serializeTeacherInfoContent,
  type TeacherInfoBlock,
  type TeacherInfoContent,
  type TeacherInfoProfileConfig,
} from "@/lib/teacher-info/types";
import { TEACHER_INFO_ATTACHMENT_MAX_BYTES } from "@/lib/teacher-info/storage";

type EditableBlock = TeacherInfoBlock;

type NewBlockDraft = {
  title: string;
  body: string;
  attachmentName: string | null;
  attachmentUrl: string | null;
  attachmentMimeType: string | null;
  attachmentSizeBytes: number | null;
  attachmentStoragePath: string | null;
};
const MAX_TEMPLATE_COUNT = 5;

function defaultProfileConfig(userId: string): TeacherInfoProfileConfig {
  const nowIso = new Date().toISOString();
  return {
    userId,
    headline: "",
    introText: "",
    isEnabled: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function emptyNewBlock(): NewBlockDraft {
  return {
    title: "",
    body: "",
    attachmentName: null,
    attachmentUrl: null,
    attachmentMimeType: null,
    attachmentSizeBytes: null,
    attachmentStoragePath: null,
  };
}

type UploadedAttachment = {
  name: string;
  url: string;
  mimeType: string | null;
  sizeBytes: number | null;
  storagePath: string | null;
};

function formatAttachmentSize(sizeBytes: number | null) {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

type TeacherInfoManagerProps = {
  embedded?: boolean;
};

export default function TeacherInfoManager({ embedded = false }: TeacherInfoManagerProps) {
  const newAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const existingAttachmentInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [profileConfig, setProfileConfig] = useState<TeacherInfoProfileConfig | null>(null);
  const [blocks, setBlocks] = useState<EditableBlock[]>([]);
  const [newBlock, setNewBlock] = useState<NewBlockDraft>(emptyNewBlock());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [busyBlockId, setBusyBlockId] = useState<string | null>(null);
  const [creatingBlock, setCreatingBlock] = useState(false);
  const [deleteConfirmBlockId, setDeleteConfirmBlockId] = useState<string | null>(null);
  const [uploadingTarget, setUploadingTarget] = useState<"new" | string | null>(null);

  const eligible = canManageTeacherInfo(roles);
  const usageSummary = useMemo(() => `${blocks.length}/${MAX_TEMPLATE_COUNT} templates`, [blocks]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const authRes = await supabase.auth.getUser();
        const currentUser = authRes.data.user;
        if (!currentUser) {
          window.location.assign("/auth");
          return;
        }

        const profileRes = await supabase.from("profiles").select("user_id,roles").eq("user_id", currentUser.id).maybeSingle();
        if (profileRes.error || !profileRes.data) {
          throw new Error(profileRes.error?.message ?? "Could not load your profile.");
        }

        const profileRow = profileRes.data as { user_id?: string; roles?: unknown };
        const nextRoles = Array.isArray(profileRow.roles) ? profileRow.roles.filter((item): item is string => typeof item === "string") : [];
        const [teacherProfile, teacherBlocks] = await Promise.all([
          fetchTeacherInfoProfile(supabase, currentUser.id),
          fetchTeacherInfoBlocks(supabase, currentUser.id),
        ]);

        if (cancelled) return;
        setUserId(currentUser.id);
        setRoles(nextRoles);
        setProfileConfig(teacherProfile ?? defaultProfileConfig(currentUser.id));
        setBlocks(teacherBlocks);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load teacher info.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    const timeoutId = window.setTimeout(() => setError(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [error]);

  useEffect(() => {
    if (!info) return;
    const timeoutId = window.setTimeout(() => setInfo(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [info]);

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    if (!token) throw new Error("Please sign in again.");
    return token;
  }

  async function authorizedFetch(url: string, init?: RequestInit) {
    const token = await getAccessToken();
    const headers = new Headers(init?.headers ?? {});
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(url, {
      ...init,
      headers,
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: string; attachment?: UploadedAttachment }
      | null;

    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error ?? "Request failed.");
    }
    return payload ?? { ok: true };
  }

  async function uploadAttachmentFile(file: File | null, target: "new" | string) {
    if (!file) return;
    setUploadingTarget(target);
    setError(null);
    setInfo(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const payload = await authorizedFetch("/api/teacher-info/attachments", {
        method: "POST",
        body: formData,
      });
      const attachment = payload.attachment;
      if (!attachment?.name || !attachment.url) {
        throw new Error("Attachment upload failed.");
      }

      if (target === "new") {
        setNewBlock((current) => ({
          ...current,
          attachmentName: attachment.name,
          attachmentUrl: attachment.url,
          attachmentMimeType: attachment.mimeType,
          attachmentSizeBytes: attachment.sizeBytes,
          attachmentStoragePath: attachment.storagePath,
        }));
      } else {
        updateBlock(target, {
          contentJson: {
            ...blocks.find((block) => block.id === target)?.contentJson,
            attachmentName: attachment.name,
            attachmentUrl: attachment.url,
            attachmentMimeType: attachment.mimeType,
            attachmentSizeBytes: attachment.sizeBytes,
            attachmentStoragePath: attachment.storagePath,
          },
        });
      }
      setInfo("Attachment uploaded.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload attachment.");
    } finally {
      setUploadingTarget(null);
      if (target === "new" && newAttachmentInputRef.current) newAttachmentInputRef.current.value = "";
      if (target !== "new" && existingAttachmentInputRefs.current[target]) {
        existingAttachmentInputRefs.current[target]!.value = "";
      }
    }
  }

  async function clearDraftAttachment() {
    const currentPath = newBlock.attachmentStoragePath;
    setNewBlock((current) => ({
      ...current,
      attachmentName: null,
      attachmentUrl: null,
      attachmentMimeType: null,
      attachmentSizeBytes: null,
      attachmentStoragePath: null,
    }));
    if (newAttachmentInputRef.current) newAttachmentInputRef.current.value = "";
    if (currentPath) {
      await authorizedFetch("/api/teacher-info/attachments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: currentPath }),
      }).catch(() => undefined);
    }
  }

  function clearBlockAttachment(blockId: string) {
    const block = blocks.find((item) => item.id === blockId);
    updateBlock(blockId, {
      contentJson: {
        ...block?.contentJson,
        attachmentName: null,
        attachmentUrl: null,
        attachmentMimeType: null,
        attachmentSizeBytes: null,
        attachmentStoragePath: null,
      },
    });
    if (existingAttachmentInputRefs.current[blockId]) {
      existingAttachmentInputRefs.current[blockId]!.value = "";
    }
  }

  async function saveProfileConfig() {
    if (!userId || !profileConfig) return;
    setSavingProfile(true);
    setError(null);
    setInfo(null);
    try {
      const payload = {
        user_id: userId,
        headline: profileConfig.headline?.trim() || null,
        intro_text: profileConfig.introText?.trim() || null,
        is_enabled: profileConfig.isEnabled,
      };
      const { data, error: saveError } = await supabase
        .from("teacher_info_profiles")
        .upsert(payload, { onConflict: "user_id" })
        .select("user_id,headline,intro_text,is_enabled,created_at,updated_at")
        .single();
      if (saveError) throw saveError;
      setProfileConfig({
        userId,
        headline: (data as { headline?: string | null }).headline ?? null,
        introText: (data as { intro_text?: string | null }).intro_text ?? null,
        isEnabled: Boolean((data as { is_enabled?: boolean }).is_enabled),
        createdAt: (data as { created_at?: string }).created_at ?? profileConfig.createdAt,
        updatedAt: (data as { updated_at?: string }).updated_at ?? new Date().toISOString(),
      });
      setInfo("Teacher info profile saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save teacher info.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function createBlock() {
    if (!userId) return;
    if (blocks.length >= MAX_TEMPLATE_COUNT) {
      setError(`You can keep up to ${MAX_TEMPLATE_COUNT} templates.`);
      return;
    }
    if (!newBlock.title.trim()) {
      setError("Template title is required.");
      return;
    }
    if (!newBlock.body.trim()) {
      setError("Template text is required.");
      return;
    }

    setCreatingBlock(true);
    setError(null);
    setInfo(null);
    try {
      const nextPosition = blocks.length > 0 ? Math.max(...blocks.map((block) => block.position)) + 1 : 0;
      const { data, error: createError } = await supabase
        .from("teacher_info_blocks")
        .insert({
          user_id: userId,
          kind: "other",
          title: newBlock.title.trim(),
          short_summary: null,
          content_json: serializeTeacherInfoContent({
            notesText: newBlock.body.trim(),
            attachmentName: newBlock.attachmentName,
            attachmentUrl: newBlock.attachmentUrl,
            attachmentMimeType: newBlock.attachmentMimeType,
            attachmentSizeBytes: newBlock.attachmentSizeBytes,
            attachmentStoragePath: newBlock.attachmentStoragePath,
          }),
          is_active: true,
          position: nextPosition,
        })
        .select("id,user_id,kind,title,short_summary,content_json,is_active,position,created_at,updated_at")
        .single();
      if (createError) throw createError;

      const created = (await fetchTeacherInfoBlocks(supabase, userId)).find((block) => block.id === (data as { id?: string }).id);
      if (created) {
        setBlocks((current) => [...current, created].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)));
      }
      setNewBlock(emptyNewBlock());
      setInfo("Template created.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the template.");
    } finally {
      setCreatingBlock(false);
    }
  }

  async function saveBlock(block: EditableBlock) {
    setBusyBlockId(block.id);
    setError(null);
    setInfo(null);
    try {
      const payload = {
        kind: "other",
        title: block.title.trim(),
        short_summary: null,
        content_json: serializeTeacherInfoContent({
          notesText: getTeacherInfoTemplateText(block) || null,
          attachmentName: block.contentJson.attachmentName,
          attachmentUrl: block.contentJson.attachmentUrl,
          attachmentMimeType: block.contentJson.attachmentMimeType,
          attachmentSizeBytes: block.contentJson.attachmentSizeBytes,
          attachmentStoragePath: block.contentJson.attachmentStoragePath,
        }),
        is_active: block.isActive,
        position: block.position,
      };
      const { error: saveError } = await supabase.from("teacher_info_blocks").update(payload).eq("id", block.id);
      if (saveError) throw saveError;
      setInfo(`Saved "${block.title}".`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the template.");
    } finally {
      setBusyBlockId(null);
    }
  }

  async function deleteBlock(blockId: string) {
    setBusyBlockId(blockId);
    setError(null);
    setInfo(null);
    try {
      const targetBlock = blocks.find((block) => block.id === blockId);
      const { error: deleteError } = await supabase.from("teacher_info_blocks").delete().eq("id", blockId);
      if (deleteError) throw deleteError;
      const attachmentStoragePath = targetBlock?.contentJson.attachmentStoragePath;
      if (attachmentStoragePath) {
        await authorizedFetch("/api/teacher-info/attachments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath: attachmentStoragePath }),
        }).catch(() => undefined);
      }
      setBlocks((current) => current.filter((block) => block.id !== blockId).map((block, index) => ({ ...block, position: index })));
      setDeleteConfirmBlockId((current) => (current === blockId ? null : current));
      setInfo("Template removed.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not remove the template.");
    } finally {
      setBusyBlockId(null);
    }
  }

  async function moveBlock(blockId: string, direction: -1 | 1) {
    const index = blocks.findIndex((block) => block.id === blockId);
    if (index < 0) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= blocks.length) return;

    const reordered = [...blocks];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved);
    const normalized = reordered.map((block, position) => ({ ...block, position }));
    setBlocks(normalized);
    setBusyBlockId(blockId);
    setError(null);
    setInfo(null);
    try {
      await Promise.all(
        normalized.map((block) =>
          supabase.from("teacher_info_blocks").update({ position: block.position }).eq("id", block.id)
        )
      );
      setInfo("Block order updated.");
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Could not reorder blocks.");
    } finally {
      setBusyBlockId(null);
    }
  }

  function updateBlock(blockId: string, patch: Partial<EditableBlock>) {
    setBlocks((current) => current.map((block) => (block.id === blockId ? { ...block, ...patch } : block)));
  }

  function updateBlockBody(blockId: string, value: string) {
    setBlocks((current) =>
      current.map((block) =>
        block.id === blockId
          ? {
              ...block,
              contentJson: {
                ...block.contentJson,
                notesText: value,
              },
              shortSummary: null,
            }
          : block
      )
    );
  }

  function updateBlockContent(blockId: string, key: keyof TeacherInfoContent, value: string | null) {
    setBlocks((current) =>
      current.map((block) =>
        block.id === blockId
          ? {
              ...block,
              contentJson: {
                ...block.contentJson,
                [key]: value,
              },
            }
          : block
      )
    );
  }

  const content = (
    <div className="space-y-6">
      {!embedded ? (
        <section className="rounded-3xl border border-white/10 bg-[#0b1a1d]/70 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Link href="/account-settings" className="inline-flex items-center gap-1 text-sm text-cyan-200/80 hover:text-cyan-100">
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                Back
              </Link>
              <h1 className="mt-3 text-3xl font-black text-white">Teacher services</h1>
              <p className="mt-2 text-sm text-slate-300">Keep a few professional info packs ready to share.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-slate-200">{usageSummary}</div>
          </div>
        </section>
      ) : null}

      {error ? <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}
      {info ? <div className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">{info}</div> : null}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-3xl border border-white/10 bg-white/[0.03]" />
          ))}
        </div>
      ) : !eligible ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-xl font-bold text-white">Teacher info is not available for this profile yet.</h2>
          <p className="mt-2 text-sm text-slate-400">Add a teacher, artist, instructor, or organizer role in your profile to unlock this section.</p>
          <div className="mt-4">
            <Link
              href="/me/edit"
              className="inline-flex rounded-2xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-[#06121a]"
            >
              Edit profile roles
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section>
            <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white">Request Teaching Info</h2>
                  <p className="mt-1 text-sm text-slate-400">Let people request your teaching details before connecting.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void saveProfileConfig()}
                  disabled={savingProfile}
                  className="rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-[#06121a] disabled:opacity-60"
                >
                  {savingProfile ? "Saving..." : "Save"}
                </button>
              </div>
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">Enable teaching info requests</p>
                    <p className="mt-1 text-sm text-slate-400">People can ask for professional details and you can reply with a note or a quick template.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(profileConfig?.isEnabled)}
                    onClick={() => setProfileConfig((current) => (current ? { ...current, isEnabled: !current.isEnabled } : current))}
                    className={[
                      "inline-flex min-h-11 items-center gap-3 rounded-full border px-3 py-2 text-sm font-semibold transition",
                      profileConfig?.isEnabled ? "border-cyan-300/45 bg-cyan-300/15 text-cyan-100" : "border-white/15 bg-white/[0.04] text-slate-300",
                    ].join(" ")}
                  >
                    <span className={["relative inline-flex h-6 w-11 rounded-full transition", profileConfig?.isEnabled ? "bg-cyan-300/65" : "bg-white/15"].join(" ")}>
                      <span className={["absolute top-0.5 h-5 w-5 rounded-full bg-white transition", profileConfig?.isEnabled ? "left-[22px]" : "left-0.5"].join(" ")} />
                    </span>
                    {profileConfig?.isEnabled ? "On" : "Off"}
                  </button>
                </div>
              </div>

              <div className="mt-6 border-t border-white/10 pt-6">
                <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white">Quick templates</h2>
                  <p className="mt-1 text-sm text-slate-400">Keep up to {MAX_TEMPLATE_COUNT} info packs ready to send.</p>
                </div>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-slate-300">{usageSummary}</span>
                </div>
              <div className="mt-4 grid gap-4">
                <label className="block">
                  <span className="text-sm font-semibold text-white">Template title</span>
                  <input
                    value={newBlock.title}
                    onChange={(event) => setNewBlock((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Single private class"
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-white">Template text</span>
                  <textarea
                    value={newBlock.body}
                    onChange={(event) => setNewBlock((current) => ({ ...current, body: event.target.value }))}
                    rows={5}
                    placeholder="It costs 50 EUR, lasts 1 hour, and studio rental is not included."
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 text-white placeholder:text-slate-500 outline-none"
                  />
                </label>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Attachment</p>
                      <p className="mt-1 text-xs text-slate-400">Add one PDF or image up to {Math.round(TEACHER_INFO_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => newAttachmentInputRef.current?.click()}
                      disabled={uploadingTarget === "new"}
                      className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-60"
                    >
                      {uploadingTarget === "new" ? "Uploading..." : newBlock.attachmentUrl ? "Replace attachment" : "Add attachment"}
                    </button>
                    <input
                      ref={newAttachmentInputRef}
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(event) => void uploadAttachmentFile(event.target.files?.[0] ?? null, "new")}
                    />
                  </div>
                  {newBlock.attachmentUrl && newBlock.attachmentName ? (
                    <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{newBlock.attachmentName}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {[newBlock.attachmentMimeType, formatAttachmentSize(newBlock.attachmentSizeBytes)].filter(Boolean).join(" • ")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <a
                          href={newBlock.attachmentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/85 hover:bg-white/[0.08]"
                        >
                          Open
                        </a>
                        <button
                          type="button"
                          onClick={clearDraftAttachment}
                          className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-100"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void createBlock()}
                  disabled={creatingBlock || blocks.length >= MAX_TEMPLATE_COUNT}
                  className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
                >
                  {creatingBlock ? "Creating..." : blocks.length >= MAX_TEMPLATE_COUNT ? "Template limit reached" : "Add template"}
                </button>
                {blocks.length > 0 ? (
                  <div className="mt-5 space-y-4 border-t border-white/10 pt-5">
                    {blocks.map((block, index) => (
                      <article key={block.id} className="rounded-3xl border border-white/10 bg-black/20 p-5">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void moveBlock(block.id, -1)}
                              disabled={busyBlockId === block.id || index === 0}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-black/20 text-slate-100 disabled:opacity-40"
                              aria-label="Move up"
                            >
                              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void moveBlock(block.id, 1)}
                              disabled={busyBlockId === block.id || index === blocks.length - 1}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-black/20 text-slate-100 disabled:opacity-40"
                              aria-label="Move down"
                            >
                              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void saveBlock(block)}
                              disabled={busyBlockId === block.id}
                              className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-60"
                            >
                              {busyBlockId === block.id ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmBlockId((current) => (current === block.id ? null : block.id))}
                              disabled={busyBlockId === block.id}
                              className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 disabled:opacity-60"
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-4">
                          <label className="block">
                            <span className="text-sm font-semibold text-white">Title</span>
                            <input
                              value={block.title}
                              onChange={(event) => updateBlock(block.id, { title: event.target.value })}
                              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none"
                            />
                          </label>
                          <label className="block">
                            <span className="text-sm font-semibold text-white">Text</span>
                            <textarea
                              value={getTeacherInfoTemplateText(block)}
                              onChange={(event) => updateBlockBody(block.id, event.target.value)}
                              rows={5}
                              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 text-white outline-none"
                            />
                          </label>
                          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-sm font-semibold text-white">Attachment</p>
                                <p className="mt-1 text-xs text-slate-400">Optional PDF or image. It will be included when this template is shared.</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => existingAttachmentInputRefs.current[block.id]?.click()}
                                disabled={uploadingTarget === block.id}
                                className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-60"
                              >
                                {uploadingTarget === block.id ? "Uploading..." : getTeacherInfoAttachment(block) ? "Replace attachment" : "Add attachment"}
                              </button>
                              <input
                                ref={(node) => {
                                  existingAttachmentInputRefs.current[block.id] = node;
                                }}
                                type="file"
                                accept="application/pdf,image/jpeg,image/png,image/webp"
                                className="hidden"
                                onChange={(event) => void uploadAttachmentFile(event.target.files?.[0] ?? null, block.id)}
                              />
                            </div>
                            {getTeacherInfoAttachment(block) ? (
                              <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-white">{getTeacherInfoAttachment(block)?.name}</p>
                                  <p className="mt-1 text-xs text-slate-400">
                                    {[getTeacherInfoAttachment(block)?.mimeType, formatAttachmentSize(getTeacherInfoAttachment(block)?.sizeBytes ?? null)].filter(Boolean).join(" • ")}
                                  </p>
                                </div>
                                <div className="flex gap-2">
                                  <a
                                    href={getTeacherInfoAttachment(block)?.url ?? "#"}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/85 hover:bg-white/[0.08]"
                                  >
                                    Open
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => clearBlockAttachment(block.id)}
                                    className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-100"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                          {deleteConfirmBlockId === block.id ? (
                            <div className="rounded-2xl border border-rose-300/30 bg-rose-500/10 p-4">
                              <p className="text-sm font-medium text-rose-100">Delete this template?</p>
                              <p className="mt-1 text-sm text-rose-100/75">This removes the template from your quick replies.</p>
                              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                                <button
                                  type="button"
                                  onClick={() => setDeleteConfirmBlockId(null)}
                                  className="rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2 text-sm font-medium text-white/85 hover:bg-white/[0.08]"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteBlock(block.id)}
                                  disabled={busyBlockId === block.id}
                                  className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 disabled:opacity-60"
                                >
                                  {busyBlockId === block.id ? "Deleting..." : "Delete template"}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
              </div>
            </article>
          </section>
        </>
      )}
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <Nav />
      <main className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        {content}
      </main>
    </div>
  );
}
