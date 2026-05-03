import { absolutePublicAppUrl } from "@/lib/public-app-url";

export type BlogPostSection = {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type BlogPost = {
  slug: string;
  title: string;
  category: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  coverImage: string;
  coverImageAlt: string;
  date: string;
  publishedAt: string;
  readTime: string;
  tags: string[];
  sections: BlogPostSection[];
};

export const BLOG_DESCRIPTION =
  "Guides for dance travel, private classes, hosting, events, and building real connections in the dance community.";

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "what-is-conxion",
    title: "What is ConXion? A better way to plan your dance life together",
    category: "Community",
    excerpt: "ConXion is built for dancers who need more than Instagram, WhatsApp, and scattered event chats.",
    metaTitle: "What is ConXion? A better way to plan your dance life together",
    metaDescription:
      "ConXion helps dancers, travelers, teachers, and organizers connect, coordinate, and plan their dance life together.",
    coverImage: "/images/blog/blog-01-conxion-intro-clean.jpg",
    coverImageAlt: "A dance couple standing together on a palm-lined promenade at sunset.",
    date: "2026-04-23",
    publishedAt: "2026-04-23T12:00:00.000Z",
    readTime: "5 min read",
    tags: ["Community", "ConXion", "Dance"],
    sections: [
      {
        paragraphs: [
          "ConXion is a platform for people whose dance life already lives across multiple places at once: events, trips, hosting, classes, private requests, connections, and chats.",
          "Most dancers today still coordinate through a mix of Instagram, WhatsApp, spreadsheets, event pages, and memory. That works until it becomes noise.",
        ],
      },
      {
        heading: "Why scattered tools stop working",
        paragraphs: [
          "The problem is usually not access to people. The problem is fragmentation. One event lives on one page, a host is in a private chat, a travel plan is in a group message, and the next practice idea gets lost between them.",
          "That fragmentation creates friction exactly where dancers need clarity most: who is going, who is available, what the context is, and what should happen next.",
        ],
      },
      {
        heading: "What ConXion brings together",
        paragraphs: [
          "ConXion brings the important parts closer together. You can discover people, see context, manage requests, coordinate events, and build trust through real interactions instead of random messages.",
        ],
        bullets: [
          "See people, plans, and event context in one place.",
          "Turn vague conversations into clearer requests and next steps.",
          "Build trust through activity, references, and visible context.",
        ],
      },
      {
        heading: "Built for real dance life",
        paragraphs: [
          "It is not meant to replace the social part of dance. It is meant to reduce the chaos around it.",
          "Whether you travel for festivals, host dancers, teach private classes, or just want to know who is going where, ConXion is designed to help you plan your dance life together.",
        ],
      },
    ],
  },
  {
    slug: "find-dance-partners-events-hosts",
    title: "How to find dance partners, events, and hosts more safely",
    category: "Guide",
    excerpt: "A better dance experience starts with better coordination, better context, and better trust.",
    metaTitle: "How to find dance partners, events, and hosts more safely",
    metaDescription:
      "Practical ways to find dance partners, events, and hosting with more clarity, trust, and less chaos.",
    coverImage: "/images/blog/blog-02-find-partners-clean.jpg",
    coverImageAlt: "A smiling dance couple social dancing in a lively city square at dusk.",
    date: "2026-04-23",
    publishedAt: "2026-04-23T11:00:00.000Z",
    readTime: "6 min read",
    tags: ["Guide", "Safety", "Dance Travel"],
    sections: [
      {
        paragraphs: [
          "The problem is rarely that dancers cannot find people. The problem is that they cannot find the right context fast enough.",
          "A good connection usually needs three things: shared intent, enough trust, and a clear next step.",
        ],
      },
      {
        heading: "Start with intent, not volume",
        paragraphs: [
          "Instead of sending vague messages to many people, it helps to know why you want to connect. Practice, travel, events, hosting, classes, and collaboration all create different expectations.",
          "When your intent is clear, the other person can answer faster and more honestly. That alone reduces a lot of unnecessary friction.",
        ],
      },
      {
        heading: "Look for trust tied to real activity",
        paragraphs: [
          "It also helps when trust is tied to real activity. Hosting history, completed classes, repeated practice, and real references matter more than generic social signals.",
        ],
        bullets: [
          "Check whether the person has relevant references for the context you need.",
          "Review activity history that matches your goal, like hosting, classes, or dance travel.",
          "Prefer people and spaces where the next step is explicit instead of implied.",
        ],
      },
      {
        heading: "Clarity is a safety feature",
        paragraphs: [
          "A better dance network is not louder. It is clearer.",
          "The more context you have before a message turns into a real plan, the easier it is to choose well, decline early, and move forward with less chaos.",
        ],
      },
    ],
  },
  {
    slug: "teachers-manage-class-requests",
    title: "How teachers can use ConXion to manage class requests",
    category: "Teachers",
    excerpt: "Teachers need more than DMs. They need structured requests, visibility, and a cleaner way to manage students.",
    metaTitle: "How teachers can use ConXion to manage class requests",
    metaDescription:
      "ConXion helps teachers showcase services, manage inquiries, and coordinate private classes more clearly.",
    coverImage: "/images/blog/blog-03-teachers-guide-clean.jpg",
    coverImageAlt: "A dance teacher guiding a student during a private lesson in a studio.",
    date: "2026-04-23",
    publishedAt: "2026-04-23T10:00:00.000Z",
    readTime: "6 min read",
    tags: ["Teachers", "Private Classes", "Requests"],
    sections: [
      {
        paragraphs: [
          "For many teachers, private class management is still fragmented. Someone writes on Instagram, someone else asks on WhatsApp, another person wants prices by email, and availability lives in the teacher’s head.",
          "ConXion gives teachers a more structured layer.",
        ],
      },
      {
        heading: "Show students what matters before the DM",
        paragraphs: [
          "A teacher profile can show services, weekly availability, regular classes, and event presence. That helps students understand whether they are asking the right person before the conversation even starts.",
        ],
        bullets: [
          "Services and formats you offer",
          "Availability and teaching rhythm",
          "Where you are teaching or traveling next",
        ],
      },
      {
        heading: "Turn inquiries into structured requests",
        paragraphs: [
          "Students can send a request instead of starting a messy back-and-forth. That request can hold the useful context up front, so the first reply is closer to a decision than a discovery process.",
          "That request can then become a confirmed private class, a clean chat thread, and later a real activity record.",
        ],
      },
      {
        heading: "Reduce friction without removing the human part",
        paragraphs: [
          "The goal is not to over-automate teaching. The goal is to reduce friction around it.",
          "When the structure is clearer, teachers spend less time chasing basic details and more time teaching, responding well, and building stronger student relationships.",
        ],
      },
    ],
  },
  {
    slug: "plan-dance-travel-better",
    title: "How to plan your dance travel better for festivals and socials",
    category: "Travel",
    excerpt: "Dance travel gets easier when events, people, hosting, and plans live closer together.",
    metaTitle: "How to plan your dance travel better for festivals and socials",
    metaDescription:
      "A simple guide to planning dance travel, coordinating with people, and reducing last-minute chaos.",
    coverImage: "/images/blog/blog-04-dance-travel-clean.jpg",
    coverImageAlt: "A sunset coastal travel scene with hillside lights overlooking the sea.",
    date: "2026-04-23",
    publishedAt: "2026-04-23T09:00:00.000Z",
    readTime: "7 min read",
    tags: ["Travel", "Festivals", "Planning"],
    sections: [
      {
        paragraphs: [
          "Dance travel is exciting, but it creates the same recurring problems: who is going, where to stay, who to meet, and how to coordinate without opening ten different chats.",
          "A better system starts with context.",
        ],
      },
      {
        heading: "Start with the event, then connect the plan around it",
        paragraphs: [
          "If you know who is attending an event, who is traveling, who can host, and which private groups or event spaces exist for coordination, planning becomes lighter.",
          "The trip feels simpler when discovery, attendance, hosting, and logistics are not split across unrelated places.",
        ],
      },
      {
        heading: "Use the right layer for the right stage",
        paragraphs: [
          "This is where structure matters. Public events help discovery. Request-based events help curation. Private groups help people coordinate once the plan is real.",
        ],
        bullets: [
          "Use public context for discovery and timing.",
          "Use request flows when trust or curation matters.",
          "Use smaller coordination spaces after the plan is confirmed.",
        ],
      },
      {
        heading: "Leave more energy for the dancing",
        paragraphs: [
          "The smoother the coordination, the more energy remains for the actual dancing.",
          "Good dance travel is not just about finding a festival. It is about making the people, hosting, transport, and communication feel workable before you arrive.",
        ],
      },
    ],
  },
];

export const BLOG_ENABLED = BLOG_POSTS.length >= 4;

export function getAllBlogPosts() {
  return [...BLOG_POSTS].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export function getBlogPost(slug: string) {
  return BLOG_POSTS.find((post) => post.slug === slug) ?? null;
}

export function getBlogPostUrl(slug: string) {
  return `/blog/${slug}`;
}

export function getBlogPostAbsoluteUrl(slug: string) {
  return absolutePublicAppUrl(getBlogPostUrl(slug));
}

export function formatBlogDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00.000Z`));
}
