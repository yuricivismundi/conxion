import type { TourFlow } from "./types";

export const TOUR_FLOWS: TourFlow[] = [
  {
    id: "first-connection",
    title: "Make your first connection",
    description: "Learn how to find dancers near you and send your first connection request.",
    icon: "connecting_airports",
    category: "Discovery",
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
  {
    id: "navigate-inbox",
    title: "Navigate your inbox",
    description: "Learn how to use your inbox — threads, filters, bookings, and composing messages.",
    icon: "inbox",
    category: "Discovery",
    steps: [
      {
        id: "step-inbox-heading",
        target: "tour-inbox-heading",
        route: "/messages",
        placement: "bottom",
        title: "Your inbox",
        description:
          "All your conversations live here — connections, events, groups, bookings, and service inquiries in one place.",
      },
      {
        id: "step-inbox-filter",
        target: "tour-inbox-filter",
        route: "/messages",
        placement: "bottom",
        title: "Switch inbox type",
        description:
          "Tap the filter icon to switch between Connections, Events, Groups, Bookings, and Service Inquiries.",
      },
      {
        id: "step-inbox-tabs",
        target: "tour-inbox-tabs",
        route: "/messages",
        placement: "bottom",
        title: "Filter by status",
        description:
          "Use the tabs to filter threads — Accepted, Requests, Past, or All. The badge shows pending items.",
      },
      {
        id: "step-compose",
        target: "tour-compose",
        route: "/messages",
        placement: "left",
        title: "Start a conversation",
        description:
          "Tap the compose button to start a new message with any of your connections.",
      },
    ],
  },
  {
    id: "join-event",
    title: "Join an event",
    description: "Find festivals, workshops, and socials near you and request to join.",
    icon: "festival",
    category: "Discovery",
    steps: [
      {
        id: "step-events-heading",
        target: "tour-events-heading",
        route: "/events",
        placement: "bottom",
        title: "Browse events",
        description: "This is where you find festivals, workshops, socials, and competitions happening near you or anywhere in the world.",
      },
      {
        id: "step-events-filters",
        target: "tour-events-filters",
        route: "/events",
        placement: "bottom",
        title: "Filter by location & date",
        description: "Use filters to narrow down by city, country, date range, dance style, or event type.",
      },
      {
        id: "step-event-card",
        target: "tour-event-card",
        route: "/events",
        placement: "top",
        title: "Open an event",
        description: "Click any event card to see full details — lineup, schedule, location, and who's attending.",
      },
    ],
  },
  {
    id: "book-teacher",
    title: "Book a teacher",
    description: "Find a dance teacher, explore their profile, and book a private session.",
    icon: "school",
    category: "Teachers",
    steps: [
      {
        id: "step-teachers-tab",
        target: "tour-teachers-tab",
        route: "/connections",
        placement: "bottom",
        title: "Find teachers",
        description:
          "Switch to the Teachers tab to browse professional dance teachers with active profiles in your area.",
      },
      {
        id: "step-teacher-card",
        target: "tour-teacher-card",
        route: "/connections?mode=teachers",
        placement: "right",
        title: "Explore a teacher",
        description:
          "Each card shows the teacher's styles, references, and rates. Click it to open their full teacher profile.",
      },
      {
        id: "step-book-session",
        target: "tour-book-session",
        route: "/connections?mode=teachers",
        placement: "left",
        title: "Book a session",
        description:
          "Tap Book a class to open the booking flow directly — pick a date, choose your duration, and send the request to the teacher.",
      },
    ],
  },
  {
    id: "setup-teacher-profile",
    title: "Set up your teacher profile",
    description: "Enable your public teacher page, add your bio, and open your booking calendar.",
    icon: "edit_note",
    category: "Teachers",
    steps: [
      {
        id: "step-teacher-enable",
        target: "tour-teacher-enable",
        route: "/me/edit/teacher-profile",
        placement: "bottom",
        title: "Enable your teacher profile",
        description:
          "Toggle your teacher profile on to make it visible to other dancers. You can also set whether your teacher or social profile is shown by default.",
      },
      {
        id: "step-teacher-profile-info",
        target: "tour-teacher-profile-info",
        route: "/me/edit/teacher-profile",
        placement: "top",
        title: "Fill in your profile info",
        description:
          "Add a headline, bio, your dance styles, languages, and rates. This is what students see when they visit your teacher page.",
      },
      {
        id: "step-teacher-tabs",
        target: "tour-teacher-tabs",
        route: "/me/edit/teacher-profile",
        placement: "bottom",
        title: "Manage bookings & classes",
        description:
          "Switch to Booking to set your availability and session rates, or Weekly Classes to list your group lessons. Inquiries and References are here too.",
      },
    ],
  },
  {
    id: "trips-activities",
    title: "Trips & group activities",
    description: "Create a trip, start a group, or join an activity with your connections.",
    icon: "luggage",
    category: "Trips",
    steps: [
      {
        id: "step-activity-heading",
        target: "tour-activity-heading",
        route: "/activity?tab=trips",
        placement: "bottom",
        title: "Your activities hub",
        description:
          "Everything you organise lives here — trips you plan, groups you run, events you attend, and hosting requests.",
      },
      {
        id: "step-activity-tabs",
        target: "tour-activity-tabs",
        route: "/activity?tab=trips",
        placement: "bottom",
        title: "Switch between activity types",
        description:
          "Use the tabs to navigate between Trips, Groups, Events, and Hosting. Each tab shows your activity for that type.",
      },
      {
        id: "step-create-trip",
        target: "tour-create-trip",
        route: "/activity?tab=trips",
        placement: "bottom",
        title: "Create a trip",
        description:
          "Tap Create trip to plan a dance travel with your connections. Set dates, destination, and invite who you want to travel with.",
      },
    ],
  },
  {
    id: "find-hosting",
    title: "Find a place to stay",
    description: "Browse dancers who offer hosting and send a request directly from their profile.",
    icon: "home",
    category: "Hosting",
    steps: [
      {
        id: "step-hosts-filter",
        target: "tour-hosts-filter",
        route: "/connections",
        placement: "bottom",
        title: "Filter to hosts only",
        description:
          "Toggle Hosts only to show only dancers who are currently accepting guests. The filter turns cyan when active.",
      },
      {
        id: "step-connect-host",
        target: "tour-connect-button",
        route: "/connections",
        placement: "top",
        title: "Open a host's profile",
        description:
          "Click any dancer card to view their full profile — hosting details, space type, and how many guests they accept.",
      },
      {
        id: "step-request-hosting",
        target: "tour-request-hosting",
        route: "/connections",
        placement: "top",
        title: "Send a hosting request",
        description:
          "Tap Request Hosting from their profile, choose your travel dates and reason, and send your request. They'll get notified in their inbox.",
      },
    ],
  },
  {
    id: "join-trip",
    title: "Join a trip",
    description: "Find dancers planning trips and request to travel together.",
    icon: "flight_takeoff",
    category: "Trips",
    steps: [
      {
        id: "step-discover-heading-trip",
        target: "tour-discover-heading",
        route: "/connections",
        placement: "bottom",
        title: "Start in Discover",
        description:
          "Discover is where you find dancers near you — including those who are planning upcoming trips.",
      },
      {
        id: "step-discover-travelers",
        target: "tour-travellers-tab",
        route: "/connections",
        placement: "bottom",
        title: "Switch to Travelers",
        description:
          "The Travelers tab shows dancers with active trip plans. Browse by destination, date, or travel style.",
      },
      {
        id: "step-connect-traveler",
        target: "tour-connect-button",
        route: "/connections?mode=travelers",
        placement: "top",
        title: "Connect and join",
        description:
          "Connect with a traveler you want to join, then message them to coordinate. You can also create your own trip from My Activities.",
      },
    ],
  },
  {
    id: "offer-hosting",
    title: "Offer hosting to dancers",
    description: "Set up your space to welcome visiting dancers and appear in the host directory.",
    icon: "night_shelter",
    category: "Hosting",
    steps: [
      {
        id: "step-edit-tabs",
        target: "tour-edit-tabs",
        route: "/me/edit",
        placement: "bottom",
        title: "Open your profile settings",
        description:
          "Go to Profile settings and switch to the Hosting tab to configure your space details.",
      },
      {
        id: "step-hosting-settings",
        target: "tour-hosting-settings",
        route: "/me/edit?tab=hosting",
        placement: "top",
        title: "Enable hosting",
        description:
          "Toggle Accepting hosting on, set max guests, space type, and add notes about your place. Dancers in your city will be able to find and request your space.",
      },
      {
        id: "step-hosts-filter-verify",
        target: "tour-hosts-filter",
        route: "/connections",
        placement: "bottom",
        title: "Check you appear as a host",
        description:
          "Head back to Discover and toggle Hosts only — your profile should now appear in the list for dancers near you.",
      },
    ],
  },
  {
    id: "setup-social-profile",
    title: "Set up your social profile",
    description: "Add your photo, city, dance styles, and bio so dancers can find and connect with you.",
    icon: "account_circle",
    category: "Profile",
    steps: [
      {
        id: "step-profile-edit-tabs",
        target: "tour-edit-tabs",
        route: "/me/edit",
        placement: "bottom",
        title: "Your profile settings",
        description:
          "This is where you manage everything about your public profile — info, media, hosting, and teacher profile.",
      },
      {
        id: "step-profile-basic-info",
        target: "tour-profile-basic-info",
        route: "/me/edit",
        placement: "bottom",
        title: "Fill in your basic info",
        description:
          "Add your display name, username, and city. Your city is key — it's how other dancers in your area discover you.",
      },
      {
        id: "step-profile-dance-styles",
        target: "tour-profile-dance-styles",
        route: "/me/edit",
        placement: "top",
        title: "Add your dance styles",
        description:
          "Select the styles you dance and your level for each. This appears on your profile and helps with matching in Discover.",
      },
    ],
  },
  {
    id: "get-verified",
    title: "Get verified",
    description: "Understand what verification unlocks and how to get your badge.",
    icon: "verified",
    category: "Profile",
    steps: [
      {
        id: "step-pricing-page",
        target: "tour-verified-card",
        route: "/pricing",
        placement: "top",
        title: "Verification badge",
        description:
          "Verification is a one-time payment that adds a trust badge to your profile. It unlocks hosting requests, booking, and higher visibility in Discover.",
      },
      {
        id: "step-hosts-filter-verified",
        target: "tour-hosts-filter",
        route: "/connections",
        placement: "bottom",
        title: "Why it matters",
        description:
          "Only verified members can send hosting requests and book private sessions with teachers. Toggle Hosts only to see it in action.",
      },
    ],
  },
  {
    id: "create-group",
    title: "Create & manage a group",
    description: "Start a practice group, community, or crew and invite your connections.",
    icon: "group",
    category: "Community",
    steps: [
      {
        id: "step-activity-groups",
        target: "tour-activity-tabs",
        route: "/activity?tab=groups",
        placement: "bottom",
        title: "Your groups",
        description:
          "The Groups tab in My Activities shows all groups you admin or belong to. You can search, filter, and manage them here.",
      },
      {
        id: "step-group-details",
        target: "tour-group-details",
        route: "/groups/new",
        placement: "bottom",
        title: "Name your group",
        description:
          "Give your group a name, description, and pick whether it's open or invite-only. Add a cover photo to make it stand out.",
      },
      {
        id: "step-group-create",
        target: "tour-group-create-btn",
        route: "/groups/new",
        placement: "top",
        title: "Create it",
        description:
          "Tap Create Group to publish it. You can then invite connections from the group page and manage members and settings.",
      },
    ],
  },
  {
    id: "create-event",
    title: "Create an event",
    description: "Publish a festival, workshop, social, or class and manage attendees.",
    icon: "edit_calendar",
    category: "Community",
    steps: [
      {
        id: "step-events-create",
        target: "tour-activity-create",
        route: "/activity",
        placement: "bottom",
        title: "Start from Activities",
        description:
          "Head to My Activities and tap Create event to open the event builder. You can also go directly from the Events page.",
      },
      {
        id: "step-event-essentials",
        target: "tour-event-essentials",
        route: "/events/new",
        placement: "bottom",
        title: "Fill in the essentials",
        description:
          "Add a title, event type, dates, venue, and description. A cover photo makes your event more discoverable.",
      },
      {
        id: "step-event-publish",
        target: "tour-event-publish",
        route: "/events/new",
        placement: "top",
        title: "Save a draft or publish",
        description:
          "Save as draft to keep editing, or Publish to make it live. Published events appear in the Events discovery page for all members.",
      },
    ],
  },
];

export function getFlowById(id: string): TourFlow | undefined {
  return TOUR_FLOWS.find((f) => f.id === id);
}
