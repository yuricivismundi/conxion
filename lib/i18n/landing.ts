// Quick i18n for the landing page + onboarding welcome.
// Supports en (default), es, pt. Add more by extending the dictionaries.

export type Locale = "en" | "es" | "pt";

export const SUPPORTED_LOCALES: Locale[] = ["en", "es", "pt"];

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "es" || value === "pt";
}

// Resolve a locale from a URL search param or an Accept-Language header.
export function resolveLocale(
  searchParamLang: string | string[] | undefined,
  acceptLanguage: string | null | undefined
): Locale {
  const fromParam = Array.isArray(searchParamLang) ? searchParamLang[0] : searchParamLang;
  if (isSupportedLocale(fromParam)) return fromParam;
  if (!acceptLanguage) return "en";
  const first = acceptLanguage.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  if (isSupportedLocale(first)) return first;
  return "en";
}

type Dict = {
  nav_blog: string;
  nav_login: string;
  nav_join: string;
  nav_join_short: string;

  hero_h1_top: string;
  hero_h1_accent: string;
  hero_sub: string;
  hero_cta_join: string;
  hero_cta_events: string;

  card_teacher: string;
  card_traveling: string;
  card_attending: string;
  card_refs: string;

  pillars_discovery_t: string;
  pillars_discovery_d: string;
  pillars_connection_t: string;
  pillars_connection_d: string;
  pillars_interaction_t: string;
  pillars_interaction_d: string;
  pillars_activity_t: string;
  pillars_activity_d: string;
  pillars_reference_t: string;
  pillars_reference_d: string;
  pillars_growth_t: string;
  pillars_growth_d: string;

  events_h2: string;
  events_sub: string;
  events_attending: string;
  events_best_of: string;
  events_empty_title: string;
  events_empty_sub: string;
  events_cta: string;

  safety_h2: string;
  safety_sub: string;
  safety_ref: string;
  safety_verified: string;
  safety_guidelines: string;
  safety_report: string;
  safety_quote: string;
  safety_quote_author: string;

  final_h2: string;
  final_cta: string;

  footer_company: string;
  footer_trust: string;
  footer_help: string;
  footer_social: string;
  footer_tagline: string;

  // Onboarding welcome
  welcome_h1: string;
  welcome_sub: string;
  welcome_cta: string;
  welcome_already: string;
};

const en: Dict = {
  nav_blog: "Blog",
  nav_login: "Log in",
  nav_join: "Join ConXion",
  nav_join_short: "Join",

  hero_h1_top: "Connect with",
  hero_h1_accent: "dancers worldwide",
  hero_sub: "Discover dancers, travel together, and grow your dance journey.",
  hero_cta_join: "Join ConXion",
  hero_cta_events: "Explore events",

  card_teacher: "Teacher",
  card_traveling: "Traveling",
  card_attending: "dancers attending",
  card_refs: "refs",

  pillars_discovery_t: "Discovery",
  pillars_discovery_d: "Explore events, trips, and dancers near you.",
  pillars_connection_t: "Connection",
  pillars_connection_d: "Connect by joining or requesting access.",
  pillars_interaction_t: "Interaction",
  pillars_interaction_d: "Start conversations and plan together.",
  pillars_activity_t: "Activity",
  pillars_activity_d: "Turn connections into real-life experiences.",
  pillars_reference_t: "Reference",
  pillars_reference_d: "Share feedback after each interaction.",
  pillars_growth_t: "Growth",
  pillars_growth_d: "Grow your network, unlock features, and reach more of the community.",

  events_h2: "Built for the global dance community",
  events_sub: "Explore live events from top dance cities.",
  events_attending: "attending",
  events_best_of: "Best of",
  events_empty_title: "No live events to feature yet.",
  events_empty_sub: "Explore the full events page to see what gets published next.",
  events_cta: "Explore all events",

  safety_h2: "Confidence through community.",
  safety_sub: "We've built ConXion with safety at its core, centered on mutual respect.",
  safety_ref: "Reference system",
  safety_verified: "Verified profiles",
  safety_guidelines: "Safety guidelines",
  safety_report: "Reporting tools",
  safety_quote: "\"ConXion allowed me to travel to Rome and immediately feel safe finding local socials.\"",
  safety_quote_author: "— Maria S., Bachatera",

  final_h2: "Ready to build your dance network?",
  final_cta: "Join ConXion",

  footer_company: "Company",
  footer_trust: "Trust",
  footer_help: "Help",
  footer_social: "Social",
  footer_tagline: "Connecting the world's dance community through trust and movement.",

  welcome_h1: "Welcome to ConXion",
  welcome_sub: "The global dance community. Find dancers, plan trips, host travelers, and grow your scene.",
  welcome_cta: "Get started",
  welcome_already: "Already have an account? Log in",
};

const es: Dict = {
  nav_blog: "Blog",
  nav_login: "Iniciar sesión",
  nav_join: "Únete a ConXion",
  nav_join_short: "Únete",

  hero_h1_top: "Conecta con",
  hero_h1_accent: "bailarines del mundo",
  hero_sub: "Descubre bailarines, viaja en grupo y haz crecer tu camino en el baile.",
  hero_cta_join: "Únete a ConXion",
  hero_cta_events: "Ver eventos",

  card_teacher: "Profesor",
  card_traveling: "De viaje",
  card_attending: "bailarines asistirán",
  card_refs: "ref.",

  pillars_discovery_t: "Descubre",
  pillars_discovery_d: "Explora eventos, viajes y bailarines cerca de ti.",
  pillars_connection_t: "Conecta",
  pillars_connection_d: "Conecta uniéndote o solicitando acceso.",
  pillars_interaction_t: "Interactúa",
  pillars_interaction_d: "Comienza conversaciones y planifica en equipo.",
  pillars_activity_t: "Actividad",
  pillars_activity_d: "Convierte conexiones en experiencias reales.",
  pillars_reference_t: "Referencias",
  pillars_reference_d: "Comparte tu opinión después de cada interacción.",
  pillars_growth_t: "Crece",
  pillars_growth_d: "Haz crecer tu red, desbloquea funciones y llega a más de la comunidad.",

  events_h2: "Hecho para la comunidad global del baile",
  events_sub: "Explora eventos en vivo en las principales ciudades del baile.",
  events_attending: "asistirán",
  events_best_of: "Lo mejor de",
  events_empty_title: "Aún no hay eventos en vivo.",
  events_empty_sub: "Explora la página de eventos para ver lo que se publica próximamente.",
  events_cta: "Ver todos los eventos",

  safety_h2: "Confianza a través de la comunidad.",
  safety_sub: "Construimos ConXion con la seguridad en el centro, basada en el respeto mutuo.",
  safety_ref: "Sistema de referencias",
  safety_verified: "Perfiles verificados",
  safety_guidelines: "Guía de seguridad",
  safety_report: "Herramientas de reporte",
  safety_quote: "\"ConXion me permitió viajar a Roma y sentirme segura desde el primer día encontrando socials locales.\"",
  safety_quote_author: "— Maria S., Bachatera",

  final_h2: "¿Listo para construir tu red de baile?",
  final_cta: "Únete a ConXion",

  footer_company: "Empresa",
  footer_trust: "Confianza",
  footer_help: "Ayuda",
  footer_social: "Redes",
  footer_tagline: "Conectando la comunidad mundial del baile a través de confianza y movimiento.",

  welcome_h1: "Bienvenido a ConXion",
  welcome_sub: "La comunidad global del baile. Encuentra bailarines, planea viajes, hospeda viajeros y haz crecer tu escena.",
  welcome_cta: "Comenzar",
  welcome_already: "¿Ya tienes cuenta? Inicia sesión",
};

const pt: Dict = {
  nav_blog: "Blog",
  nav_login: "Entrar",
  nav_join: "Entrar na ConXion",
  nav_join_short: "Entrar",

  hero_h1_top: "Conecte-se com",
  hero_h1_accent: "dançarinos do mundo",
  hero_sub: "Descubra dançarinos, viaje em grupo e faça sua jornada na dança crescer.",
  hero_cta_join: "Entrar na ConXion",
  hero_cta_events: "Ver eventos",

  card_teacher: "Professor",
  card_traveling: "Em viagem",
  card_attending: "dançarinos participando",
  card_refs: "refs",

  pillars_discovery_t: "Descobrir",
  pillars_discovery_d: "Explore eventos, viagens e dançarinos perto de você.",
  pillars_connection_t: "Conectar",
  pillars_connection_d: "Conecte-se entrando ou solicitando acesso.",
  pillars_interaction_t: "Interagir",
  pillars_interaction_d: "Inicie conversas e planeje em conjunto.",
  pillars_activity_t: "Atividade",
  pillars_activity_d: "Transforme conexões em experiências reais.",
  pillars_reference_t: "Referência",
  pillars_reference_d: "Compartilhe feedback após cada interação.",
  pillars_growth_t: "Crescer",
  pillars_growth_d: "Faça sua rede crescer, desbloqueie recursos e alcance mais da comunidade.",

  events_h2: "Feito para a comunidade global da dança",
  events_sub: "Explore eventos ao vivo nas principais cidades da dança.",
  events_attending: "participando",
  events_best_of: "O melhor de",
  events_empty_title: "Ainda não há eventos ao vivo para destacar.",
  events_empty_sub: "Explore a página completa de eventos para ver o que será publicado a seguir.",
  events_cta: "Ver todos os eventos",

  safety_h2: "Confiança através da comunidade.",
  safety_sub: "Construímos a ConXion com segurança no centro, baseada no respeito mútuo.",
  safety_ref: "Sistema de referências",
  safety_verified: "Perfis verificados",
  safety_guidelines: "Diretrizes de segurança",
  safety_report: "Ferramentas de denúncia",
  safety_quote: "\"ConXion me permitiu viajar para Roma e me sentir segura desde o primeiro dia encontrando socials locais.\"",
  safety_quote_author: "— Maria S., Bachatera",

  final_h2: "Pronto para construir sua rede de dança?",
  final_cta: "Entrar na ConXion",

  footer_company: "Empresa",
  footer_trust: "Confiança",
  footer_help: "Ajuda",
  footer_social: "Redes",
  footer_tagline: "Conectando a comunidade mundial da dança através de confiança e movimento.",

  welcome_h1: "Bem-vindo à ConXion",
  welcome_sub: "A comunidade global da dança. Encontre dançarinos, planeje viagens, hospede viajantes e faça sua cena crescer.",
  welcome_cta: "Começar",
  welcome_already: "Já tem uma conta? Entrar",
};

const DICTS: Record<Locale, Dict> = { en, es, pt };

export function getT(locale: Locale): Dict {
  return DICTS[locale];
}
