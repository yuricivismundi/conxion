import type { TourFlow } from "./types";

export const TOUR_FLOWS: TourFlow[] = [
  {
    id: "first-connection",
    title: "Make your first connection",
    description: "Learn how to find dancers near you and send your first connection request.",
    icon: "connecting_airports",
    steps: [
      {
        id: "step-discover-heading",
        target: "tour-discover-heading",
        route: "/connections",
        placement: "bottom",
        title: "Welcome to Discover",
        description:
          "This is where you find dancers near you. Browse by city, filter by style, and explore who's around.",
      },
      {
        id: "step-dancers-tab",
        target: "tour-dancers-tab",
        route: "/connections",
        placement: "bottom",
        title: "Find dancers",
        description:
          "The Dancers tab shows members in your area. Switch between Travelers, Events, and Teachers too.",
      },
      {
        id: "step-connect-button",
        target: "tour-connect-button",
        route: "/connections",
        placement: "top",
        title: "Send a connection",
        description:
          "Tap Connect on any profile to send a request. They'll get notified and can accept or decline.",
      },
      {
        id: "step-inbox-tabs",
        target: "tour-inbox-tabs",
        route: "/messages",
        placement: "bottom",
        title: "Check your inbox",
        description:
          "Once they accept, a conversation thread opens here. Use the tabs to filter by Accepted, Requests, or All.",
      },
      {
        id: "step-compose",
        target: "tour-compose",
        route: "/messages",
        placement: "left",
        title: "Start a conversation",
        description:
          "Use the compose button to start a new message. You can message anyone you're connected with.",
      },
    ],
  },
];

export function getFlowById(id: string): TourFlow | undefined {
  return TOUR_FLOWS.find((f) => f.id === id);
}
