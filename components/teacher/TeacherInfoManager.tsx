"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";
import { fetchTeacherInfoBlocks, fetchTeacherInfoProfile } from "@/lib/teacher-info/read-model";
import { canManageTeacherInfo } from "@/lib/teacher-info/roles";
import {
  getTeacherInfoAttachment,
  getTeacherInfoTemplateText,
  serializeTeacherInfoContent,
  type TeacherInfoBlock,
  type TeacherInfoBlockKind,
  type TeacherInfoContent,
  type TeacherInfoProfileConfig,
  TEACHER_INFO_BLOCK_KINDS,
  TEACHER_INFO_KIND_LABELS,
} from "@/lib/teacher-info/types";

type EditableBlock = TeacherInfoBlock;

type NewBlockDraft = {
  kind: TeacherInfoBlockKind;
  title: string;
  body: string;
  priceText: string;
  packageText: string;
  availabilityText: string;
  travelText: string;
  conditionsText: string;
  ctaText: string;
  referencesText: string;
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
    kind: "private_class",
    title: "",
    body: "",
    priceText: "",
    packageText: "",
    availabilityText: "",
    travelText: "",
    conditionsText: "",
    ctaText: "",
    referencesText: "",
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

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
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
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const eligible = canManageTeacherInfo(roles);

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

  async function toggleEnabled() {
    if (!userId || !profileConfig) return;
    const next = !profileConfig.isEnabled;
    setProfileConfig((c) => (c ? { ...c, isEnabled: next } : c));
    setSavingProfile(true);
    setError(null);
    setInfo(null);
    try {
      const { data, error: saveError } = await supabase
        .from("teacher_info_profiles")
        .upsert(
          { user_id: userId, headline: profileConfig.headline?.trim() || null, intro_text: profileConfig.introText?.trim() || null, is_enabled: next },
          { onConflict: "user_id" }
        )
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
      setInfo(next ? "Teaching services enabled." : "Teaching services disabled.");
    } catch (e) {
      setProfileConfig((c) => (c ? { ...c, isEnabled: !next } : c));
      setError(e instanceof Error ? e.message : "Could not save.");
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
    setCreatingBlock(true);
    setError(null);
    setInfo(null);
    try {
      const nextPosition = blocks.length > 0 ? Math.max(...blocks.map((block) => block.position)) + 1 : 0;
      const { data, error: createError } = await supabase
        .from("teacher_info_blocks")
        .insert({
          user_id: userId,
          kind: newBlock.kind,
          title: newBlock.title.trim(),
          short_summary: null,
          content_json: serializeTeacherInfoContent({
            notesText: optionalText(newBlock.body),
            priceText: optionalText(newBlock.priceText),
            packageText: optionalText(newBlock.packageText),
            availabilityText: optionalText(newBlock.availabilityText),
            travelText: optionalText(newBlock.travelText),
            conditionsText: optionalText(newBlock.conditionsText),
            ctaText: optionalText(newBlock.ctaText),
            referencesText: optionalText(newBlock.referencesText),
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
      setShowNewForm(false);
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
        kind: block.kind,
        title: block.title.trim(),
        short_summary: null,
        content_json: serializeTeacherInfoContent({
          notesText: block.contentJson.notesText ?? null,
          priceText: block.contentJson.priceText ?? null,
          packageText: block.contentJson.packageText ?? null,
          availabilityText: block.contentJson.availabilityText ?? null,
          travelText: block.contentJson.travelText ?? null,
          conditionsText: block.contentJson.conditionsText ?? null,
          ctaText: block.contentJson.ctaText ?? null,
          referencesText: block.contentJson.referencesText ?? null,
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
    <div className="space-y-4">
      {!embedded ? (
        <div className="pb-2">
          <Link href="/account-settings" className="inline-flex items-center gap-1 text-sm text-cyan-200/80 hover:text-cyan-100">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back
          </Link>
          <h1 className="mt-3 text-3xl font-black text-white">Teacher services</h1>
          <p className="mt-1 text-sm text-slate-400">Keep info packs ready to share when someone asks about your services.</p>
        </div>
      ) : null}

      {error ? <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}
      {info ? <div className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">{info}</div> : null}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
          ))}
        </div>
      ) : !eligible ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-xl font-bold text-white">Not available yet</h2>
          <p className="mt-2 text-sm text-slate-400">Add a teacher, artist, instructor, or organizer role to unlock teacher services.</p>
          <div className="mt-4">
            <Link href="/me/edit" className="inline-flex rounded-2xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-[#06121a]">
              Edit profile roles
            </Link>
          </div>
        </section>
      ) : (
        <div className="space-y-4">
          {/* Enable/disable toggle */}
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
            <div>
              <p className="font-semibold text-white">Teaching services</p>
              <p className="mt-0.5 text-sm text-slate-400">
                {profileConfig?.isEnabled
                  ? "Visible on your profile — people can request your info."
                  : "Hidden — no one can see or request your teaching info."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(profileConfig?.isEnabled)}
              onClick={() => void toggleEnabled()}
              disabled={savingProfile}
              className={[
                "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-60",
                profileConfig?.isEnabled ? "bg-cyan-400" : "bg-white/20",
              ].join(" ")}
            >
              <span
                className={[
                  "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform",
                  profileConfig?.isEnabled ? "translate-x-5" : "translate-x-0",
                ].join(" ")}
              />
            </button>
          </div>

          {/* Templates */}
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-white">Templates</h2>
                <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-xs font-semibold text-slate-400">
                  {blocks.length}/{MAX_TEMPLATE_COUNT}
                </span>
              </div>
              {blocks.length < MAX_TEMPLATE_COUNT && !showNewForm ? (
                <button
                  type="button"
                  onClick={() => { setShowNewForm(true); setExpandedBlockId(null); }}
                  className="inline-flex items-center gap-1 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Add template
                </button>
              ) : null}
            </div>

            {blocks.length === 0 && !showNewForm ? (
              <div className="border-t border-white/10 px-5 py-8 text-center">
                <p className="text-sm text-slate-400">No templates yet. Add one to get started.</p>
              </div>
            ) : null}

            {/* Existing blocks */}
            {blocks.length > 0 ? (
              <div className="divide-y divide-white/[0.06] border-t border-white/10">
                {blocks.map((block, index) => {
                  const isExpanded = expandedBlockId === block.id;
                  const attachment = getTeacherInfoAttachment(block);
                  return (
                    <div key={block.id}>
                      {/* Row header */}
                      <div className="flex w-full items-center gap-3 px-5 py-3.5 hover:bg-white/[0.03]">
                        <button
                          type="button"
                          onClick={() => setExpandedBlockId(isExpanded ? null : block.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="material-symbols-outlined text-[18px] text-slate-500">
                            {isExpanded ? "expand_less" : "expand_more"}
                          </span>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="shrink-0 rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-xs font-medium text-slate-300">
                              {TEACHER_INFO_KIND_LABELS[block.kind]}
                            </span>
                            <span className="truncate text-sm font-medium text-white">{block.title}</span>
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void moveBlock(block.id, -1)}
                            disabled={busyBlockId === block.id || index === 0}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-white/[0.08] disabled:opacity-30"
                            aria-label="Move up"
                          >
                            <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void moveBlock(block.id, 1)}
                            disabled={busyBlockId === block.id || index === blocks.length - 1}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-white/[0.08] disabled:opacity-30"
                            aria-label="Move down"
                          >
                            <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDeleteConfirmBlockId(block.id); setExpandedBlockId(null); }}
                            disabled={busyBlockId === block.id}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-rose-400/70 hover:bg-rose-500/10 disabled:opacity-30"
                            aria-label="Delete"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </div>
                      </div>

                      {/* Delete confirm */}
                      {deleteConfirmBlockId === block.id ? (
                        <div className="border-t border-rose-300/20 bg-rose-500/10 px-5 py-4">
                          <p className="text-sm font-medium text-rose-100">Delete this template?</p>
                          <p className="mt-0.5 text-xs text-rose-100/70">This cannot be undone.</p>
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmBlockId(null)}
                              className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white/80 hover:bg-white/[0.08]"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteBlock(block.id)}
                              disabled={busyBlockId === block.id}
                              className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-100 disabled:opacity-60"
                            >
                              {busyBlockId === block.id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {/* Expanded edit form */}
                      {isExpanded ? (
                        <div className="space-y-4 border-t border-white/[0.06] bg-black/20 px-5 pb-5 pt-4">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <label className="block">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Type</span>
                              <select
                                value={block.kind}
                                onChange={(e) => updateBlock(block.id, { kind: e.target.value as TeacherInfoBlockKind })}
                                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none"
                              >
                                {TEACHER_INFO_BLOCK_KINDS.map((kind) => (
                                  <option key={kind} value={kind}>{TEACHER_INFO_KIND_LABELS[kind]}</option>
                                ))}
                              </select>
                            </label>
                            <label className="block">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Title</span>
                              <input
                                value={block.title}
                                onChange={(e) => updateBlock(block.id, { title: e.target.value })}
                                placeholder="e.g. Private class package"
                                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Price per class</span>
                              <input
                                value={block.contentJson.priceText ?? ""}
                                onChange={(e) => updateBlockContent(block.id, "priceText", e.target.value)}
                                placeholder="€50 / hour"
                                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Package deal</span>
                              <input
                                value={block.contentJson.packageText ?? ""}
                                onChange={(e) => updateBlockContent(block.id, "packageText", e.target.value)}
                                placeholder="5 classes for €200"
                                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Duration</span>
                              <input
                                value={block.contentJson.availabilityText ?? ""}
                                onChange={(e) => updateBlockContent(block.id, "availabilityText", e.target.value)}
                                placeholder="60 min"
                                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Location</span>
                              <input
                                value={block.contentJson.travelText ?? ""}
                                onChange={(e) => updateBlockContent(block.id, "travelText", e.target.value)}
                                placeholder="My studio or yours"
                                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                              />
                            </label>
                            <label className="block sm:col-span-2">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Studio / rental extras</span>
                              <input
                                value={block.contentJson.conditionsText ?? ""}
                                onChange={(e) => updateBlockContent(block.id, "conditionsText", e.target.value)}
                                placeholder="Studio rental not included"
                                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                              />
                            </label>
                          </div>
                          <label className="block">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{"What's included"}</span>
                            <textarea
                              value={block.contentJson.notesText ?? ""}
                              onChange={(e) => updateBlockBody(block.id, e.target.value)}
                              rows={3}
                              placeholder="Describe what's included in this service..."
                              className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm leading-6 text-white placeholder:text-slate-600 outline-none"
                            />
                          </label>
                          <label className="block">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Extra note</span>
                            <input
                              value={block.contentJson.ctaText ?? ""}
                              onChange={(e) => updateBlockContent(block.id, "ctaText", e.target.value)}
                              placeholder="e.g. Message me with your availability"
                              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                            />
                          </label>
                          <div>
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Attachment</span>
                            {attachment ? (
                              <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                                <span className="material-symbols-outlined text-[16px] text-slate-400">attach_file</span>
                                <span className="min-w-0 flex-1 truncate text-sm text-white">{attachment.name}</span>
                                <a href={attachment.url} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 hover:underline">Open</a>
                                <button type="button" onClick={() => clearBlockAttachment(block.id)} className="text-xs text-rose-300 hover:underline">Remove</button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => existingAttachmentInputRefs.current[block.id]?.click()}
                                disabled={uploadingTarget === block.id}
                                className="mt-1.5 inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.06] disabled:opacity-60"
                              >
                                <span className="material-symbols-outlined text-[16px]">attach_file</span>
                                {uploadingTarget === block.id ? "Uploading..." : "Add attachment"}
                              </button>
                            )}
                            <input
                              ref={(node) => { existingAttachmentInputRefs.current[block.id] = node; }}
                              type="file"
                              accept="application/pdf,image/jpeg,image/png,image/webp"
                              className="hidden"
                              onChange={(e) => void uploadAttachmentFile(e.target.files?.[0] ?? null, block.id)}
                            />
                          </div>
                          <div className="flex justify-end pt-1">
                            <button
                              type="button"
                              onClick={() => void saveBlock(block)}
                              disabled={busyBlockId === block.id}
                              className="rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-[#06121a] disabled:opacity-60"
                            >
                              {busyBlockId === block.id ? "Saving..." : "Save"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* New template form */}
            {showNewForm ? (
              <div className={["space-y-4 bg-black/20 px-5 pb-5 pt-4", blocks.length > 0 ? "border-t border-white/10" : ""].join(" ")}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">New template</p>
                  <button
                    type="button"
                    onClick={() => { setShowNewForm(false); setNewBlock(emptyNewBlock()); }}
                    className="text-sm text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Type</span>
                    <select
                      value={newBlock.kind}
                      onChange={(e) => setNewBlock((c) => ({ ...c, kind: e.target.value as TeacherInfoBlockKind }))}
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none"
                    >
                      {TEACHER_INFO_BLOCK_KINDS.map((kind) => (
                        <option key={kind} value={kind}>{TEACHER_INFO_KIND_LABELS[kind]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Title <span className="text-rose-300">*</span>
                    </span>
                    <input
                      value={newBlock.title}
                      onChange={(e) => setNewBlock((c) => ({ ...c, title: e.target.value }))}
                      placeholder="e.g. Private class package"
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Price per class</span>
                    <input
                      value={newBlock.priceText}
                      onChange={(e) => setNewBlock((c) => ({ ...c, priceText: e.target.value }))}
                      placeholder="€50 / hour"
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Package deal</span>
                    <input
                      value={newBlock.packageText}
                      onChange={(e) => setNewBlock((c) => ({ ...c, packageText: e.target.value }))}
                      placeholder="5 classes for €200"
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Duration</span>
                    <input
                      value={newBlock.availabilityText}
                      onChange={(e) => setNewBlock((c) => ({ ...c, availabilityText: e.target.value }))}
                      placeholder="60 min"
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Location</span>
                    <input
                      value={newBlock.travelText}
                      onChange={(e) => setNewBlock((c) => ({ ...c, travelText: e.target.value }))}
                      placeholder="My studio or yours"
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Studio / rental extras</span>
                    <input
                      value={newBlock.conditionsText}
                      onChange={(e) => setNewBlock((c) => ({ ...c, conditionsText: e.target.value }))}
                      placeholder="Studio rental not included"
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{"What's included"}</span>
                  <textarea
                    value={newBlock.body}
                    onChange={(e) => setNewBlock((c) => ({ ...c, body: e.target.value }))}
                    rows={3}
                    placeholder="Describe what's included in this service..."
                    className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm leading-6 text-white placeholder:text-slate-600 outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Extra note</span>
                  <input
                    value={newBlock.ctaText}
                    onChange={(e) => setNewBlock((c) => ({ ...c, ctaText: e.target.value }))}
                    placeholder="e.g. Message me with your availability"
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
                  />
                </label>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Attachment</span>
                  {newBlock.attachmentUrl && newBlock.attachmentName ? (
                    <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                      <span className="material-symbols-outlined text-[16px] text-slate-400">attach_file</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-white">{newBlock.attachmentName}</span>
                      <a href={newBlock.attachmentUrl} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 hover:underline">Open</a>
                      <button type="button" onClick={clearDraftAttachment} className="text-xs text-rose-300 hover:underline">Remove</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => newAttachmentInputRef.current?.click()}
                      disabled={uploadingTarget === "new"}
                      className="mt-1.5 inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.06] disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-[16px]">attach_file</span>
                      {uploadingTarget === "new" ? "Uploading..." : "Add attachment"}
                    </button>
                  )}
                  <input
                    ref={newAttachmentInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => void uploadAttachmentFile(e.target.files?.[0] ?? null, "new")}
                  />
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => void createBlock()}
                    disabled={creatingBlock}
                    className="rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-[#06121a] disabled:opacity-60"
                  >
                    {creatingBlock ? "Creating..." : "Create template"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
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
