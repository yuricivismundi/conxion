import { useState, useCallback } from "react";

export type ActivityDraft = {
  activityType: string | null;
  note: string;
  startAt: string | null;
  endAt: string | null;
  recipientUserId: string | null;
};

export type ActivityDraftState = {
  draft: ActivityDraft;
  setActivityType: (type: string | null) => void;
  setNote: (note: string) => void;
  setStartAt: (date: string | null) => void;
  setEndAt: (date: string | null) => void;
  setRecipientUserId: (id: string | null) => void;
  clearDraft: () => void;
  updateDraft: (partial: Partial<ActivityDraft>) => void;
};

const INITIAL_DRAFT: ActivityDraft = {
  activityType: null,
  note: "",
  startAt: null,
  endAt: null,
  recipientUserId: null,
};

export function useActivityDraft(): ActivityDraftState {
  const [draft, setDraft] = useState<ActivityDraft>(INITIAL_DRAFT);

  const setActivityType = useCallback((type: string | null) => {
    setDraft((prev) => ({ ...prev, activityType: type }));
  }, []);

  const setNote = useCallback((note: string) => {
    setDraft((prev) => ({ ...prev, note }));
  }, []);

  const setStartAt = useCallback((date: string | null) => {
    setDraft((prev) => ({ ...prev, startAt: date }));
  }, []);

  const setEndAt = useCallback((date: string | null) => {
    setDraft((prev) => ({ ...prev, endAt: date }));
  }, []);

  const setRecipientUserId = useCallback((id: string | null) => {
    setDraft((prev) => ({ ...prev, recipientUserId: id }));
  }, []);

  const clearDraft = useCallback(() => {
    setDraft(INITIAL_DRAFT);
  }, []);

  const updateDraft = useCallback((partial: Partial<ActivityDraft>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  }, []);

  return {
    draft,
    setActivityType,
    setNote,
    setStartAt,
    setEndAt,
    setRecipientUserId,
    clearDraft,
    updateDraft,
  };
}
