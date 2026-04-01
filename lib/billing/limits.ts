import type { PlanId } from "@/lib/billing/plans";

export type PlanLimits = {
  activeChatThreadsPerMonth: number | null;
  initiatedChatsPerMonth: number | null;
  connectionRequestsPerMonth: number | null;
  firstMonthConnectionRequestsPerMonth: number | null;
  hostingOffersPerMonth: number | null;
  hostingRequestsPerMonth: number | null;
  tripRequestsPerMonth: number | null;
  tripsPerMonth: number | null;
  eventsPerMonth: number | null;
  profileVideos: number | null;
  profilePhotos: number | null;
};

const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  starter: {
    activeChatThreadsPerMonth: 10,
    initiatedChatsPerMonth: 10,
    connectionRequestsPerMonth: 10,
    firstMonthConnectionRequestsPerMonth: 30,
    hostingOffersPerMonth: 5,
    hostingRequestsPerMonth: null,
    tripRequestsPerMonth: 5,
    tripsPerMonth: 1,
    eventsPerMonth: 2,
    profileVideos: 2,
    profilePhotos: 1,
  },
  verified: {
    activeChatThreadsPerMonth: 10,
    initiatedChatsPerMonth: 10,
    connectionRequestsPerMonth: 10,
    firstMonthConnectionRequestsPerMonth: 30,
    hostingOffersPerMonth: 5,
    hostingRequestsPerMonth: 10,
    tripRequestsPerMonth: 5,
    tripsPerMonth: 1,
    eventsPerMonth: 2,
    profileVideos: 2,
    profilePhotos: 1,
  },
  pro: {
    activeChatThreadsPerMonth: 30,
    initiatedChatsPerMonth: 30,
    connectionRequestsPerMonth: 60,
    firstMonthConnectionRequestsPerMonth: 30,
    hostingOffersPerMonth: 10,
    hostingRequestsPerMonth: 10,
    tripRequestsPerMonth: 10,
    tripsPerMonth: 5,
    eventsPerMonth: 5,
    profileVideos: 2,
    profilePhotos: 3,
  },
};

export function getPlanLimits(planId: PlanId) {
  return PLAN_LIMITS[planId];
}

export function isLimitReached(current: number, limit: number | null) {
  if (limit === null) return false;
  return current >= limit;
}

export function getRemaining(limit: number | null, current: number) {
  if (limit === null) return null;
  return Math.max(limit - current, 0);
}
