# ConXion stakeholder overview

Generated: 2026-05-21

## Overview

ConXion is a trust-first web platform for the global dance community. It brings discovery, messaging, events, trips, hosting, groups, references, and professional teacher tools into one coordinated system.

## Executive summary

ConXion is a trust-first web platform for the global dance community. It combines discovery, structured requests, activity coordination, messaging, trust signals, and professional tools in one product instead of forcing members to split their planning across Instagram, WhatsApp, event chats, spreadsheets, and disconnected booking tools.
The current product is organized around four high-value behaviors: finding the right people, coordinating real activities, building trust through completed interactions, and converting professional or organizer demand into structured requests instead of informal chat noise.
For stakeholders, the key point is that ConXion is not a generic social network. It is a vertical coordination layer for dancers, travellers, teachers, hosts, and organizers, with monetization tied to trust access, visibility, and higher-usage operational workflows.

## Who the app is for

The core audience is social dancers and dance travellers who need more context before they connect. Around that core, the platform also supports teachers, artists, DJs, organizers, hosts, and small local communities that need a cleaner way to coordinate classes, trips, events, and hosting.

- Social dancers looking for practice, events, and trusted local connections
- Travellers coordinating festivals, dance holidays, and hosting stays
- Teachers and artists presenting services, availability, and booking options
- Organizers creating events, handling invites, and managing event participation
- Private communities that want a members-only group space tied to the same trust layer

## Main product areas

The current codebase exposes a broad but coherent set of user-facing modules. They work as one system rather than as isolated tools.

- Discovery and connections: browse dancers, travellers, hosts, and specialized profiles with filters for city, role, trust, and context.
- Messages: one-to-one, event, group, and request-driven conversations, with request context, archive, pinning, mute, search, and trust-oriented side panels.
- Activity hub: a single area for events, trips, groups, and hosting so members can manage what they created, joined, requested, or archived.
- Events: public events, request-based events, and private-group mode built on shared event infrastructure.
- Trips and hosting: structured trip creation, join-trip requests, hosting offers, hosting requests, and travel-specific chat context.
- Profiles: public social profiles, trust indicators, references, media, and optional teacher profile mode.
- Teacher tools: availability, classes, event presence, inquiry handling, and structured private-class booking.
- References and trust: relationship-aware reference prompts, activity-based trust eligibility, and visible interaction history.
- Notifications and support: in-app notices, request tracking, moderation hooks, help center, safety center, and support flows.
- Commercial layer: Starter, Verified, and Plus plans with plan-aware limits and upgrade paths across the app.

## Core user journeys

The strongest current flows are built around intent. Members are not only chatting; they are coordinating a concrete context such as a trip, hosting stay, event, practice session, private class, or group.

- Connection flow: a member discovers another member, sends a connection request, and after acceptance can use the shared thread as the base for later activity requests.
- Trip flow: a traveller creates a trip, other members join it through structured reasons, and accepted trip context remains attached to the same relationship thread.
- Hosting flow: a host can offer hosting, or a verified traveller can request hosting. The request carries dates and participant context so future trust is attached to the correct stay.
- Event flow: an organizer creates an event, controls access, sends invites, manages visibility and guest settings, and gains a dedicated event thread.
- Group flow: a member creates or joins a private group that reuses event infrastructure for membership and discussion logic rather than creating a completely separate system.
- Teacher flow: a verified teacher exposes services, classes, availability, and booking requests so students can request a session without fragmented back-and-forth.

## Trust and safety model

Trust is not treated as a vanity metric. The product separates accepted activities, interaction counts, and written references so repeated real experiences can still matter without letting members spam public endorsements.
References unlock after completed activities, not merely after a connection starts. Cooldowns and one-reference-per-completed-activity rules vary by context to keep trust signals meaningful.

- Practice and Social Dance share a 120-day reference cooldown per pair.
- Private Class uses a 90-day reference cooldown per pair.
- Travelling, Request Hosting, Offer Hosting, Event/Festival, and Collaborate can generate one reference per completed activity.
- Completed activities also create interaction counts that appear separately from written references.
- The platform includes blocking, reporting, moderation case handling, support tickets, and a dedicated safety center.

## Messaging, notifications, and operational context

Messages are a core operating layer, not just a chat feature. Threads carry relationship context, request state, pinned items, event or group details, and request-specific actions. The same thread becomes the operating record for accepted activities over time.
Current event and group message experiences include dedicated side panels with organizer details, participants or attending connections, event or group settings, and message-level controls such as pinning, muting, search, and archive.
Notifications and email are used selectively. For example, event request and join lifecycle messages are wired into email, while membership and thread access are represented inside the app where the long-term relationship context lives.

## Teacher and professional layer

ConXion includes a professional mode for verified members who teach or offer services. The public teacher profile is not only a marketing page; it is an operational funnel that ties directly into inquiries, bookings, and calendar-based availability.

- Teacher headline, bio, city, language, and travel availability
- Regular classes and event teaching presence
- Experiences and media showcases
- Private class booking requests with time-slot selection
- Inquiry management in the member's own account area

## Commercial model and monetization

The commercial design is usage-based and trust-based rather than paywalling the whole platform. This gives ConXion a practical upgrade path for different member intents.

- Starter: free entry plan for discovery, core messaging, one trip per month, two events per month, and limited trust-building actions.
- Verified: one-time trust upgrade that unlocks hosted-travel confidence, hosting requests, and professional profile/inquiry access.
- Plus: monthly growth plan that expands requests, chat capacity, trips, events, invites, visibility, and profile/media allowances.
- The current implementation already applies plan-aware limits across connection requests, active chats, trips, events, hosting, invitations, and group slots.

## Current plan structure

The present billing logic uses three plans. Values below reflect the current implementation in code as of the generated date of this document.

## What stakeholders should understand

ConXion is already more than a concept prototype. The codebase contains active implementations for discovery, messaging, trips, hosting, events, groups, trust, profiles, teacher workflows, support, pricing, and content. The main product risk is not missing surface area; it is maintaining coherence and quality as the product hardens.
That means stakeholder attention should focus on product clarity, operational quality, and which flows deserve the highest commercial or growth priority, rather than on whether the platform already has enough functional depth to explain to users or partners.

- The product is strongest where context matters: travel, hosting, events, classes, and trust.
- The trust layer is a differentiator because it is tied to completed activity rather than generic social proof.
- The activity hub and threaded request model create a clearer record of real interactions than fragmented chat-first tools.
- The teacher and organizer features create monetizable professional use cases beyond casual social discovery.
- The current architecture already supports multiple upgrade levers: trust access, visibility, higher usage, and professional conversion.
