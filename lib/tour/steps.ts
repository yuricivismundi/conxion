export type TourStep = {
  id: string;
  title: string;
  description: string;
  placement: "top" | "bottom" | "left" | "right";
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "discover",
    title: "Find dancers near you",
    description:
      "Browse dancers, travelers, teachers and events in your city or anywhere in the world.",
    placement: "bottom",
  },
  {
    id: "messages",
    title: "Your inbox",
    description:
      "All your conversations, connection requests, and activity threads live here.",
    placement: "bottom",
  },
  {
    id: "events",
    title: "Explore events",
    description:
      "Find festivals, workshops, and socials near you or plan your next trip around one.",
    placement: "bottom",
  },
  {
    id: "network",
    title: "Send your first connection",
    description:
      "Tap Connect on any dancer's card to send a connection request.",
    placement: "bottom",
  },
  {
    id: "activity",
    title: "Book a private class",
    description:
      "Find teachers in any city and book a session directly through the app.",
    placement: "bottom",
  },
];
