// Quick i18n for the landing page + onboarding welcome.
// Supports en (default), es, pt. Add more by extending the dictionaries.

export type Locale = "en" | "es" | "fr" | "de" | "it" | "nl" | "pl";

export const SUPPORTED_LOCALES: Locale[] = ["en", "es", "fr", "de", "it", "nl", "pl"];

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

const fr: Dict = {
  nav_blog: "Blog",
  nav_login: "Connexion",
  nav_join: "Rejoindre ConXion",
  nav_join_short: "Rejoindre",

  hero_h1_top: "Connecte-toi avec",
  hero_h1_accent: "des danseurs du monde entier",
  hero_sub: "Découvre des danseurs, voyage en groupe et fais évoluer ta passion pour la danse.",
  hero_cta_join: "Rejoindre ConXion",
  hero_cta_events: "Voir les événements",

  card_teacher: "Professeur",
  card_traveling: "En voyage",
  card_attending: "danseurs présents",
  card_refs: "réf.",

  pillars_discovery_t: "Découverte",
  pillars_discovery_d: "Explore des événements, voyages et danseurs près de chez toi.",
  pillars_connection_t: "Connexion",
  pillars_connection_d: "Connecte-toi en rejoignant ou en demandant l'accès.",
  pillars_interaction_t: "Interaction",
  pillars_interaction_d: "Lance des conversations et planifie ensemble.",
  pillars_activity_t: "Activité",
  pillars_activity_d: "Transforme tes connexions en expériences réelles.",
  pillars_reference_t: "Référence",
  pillars_reference_d: "Partage ton avis après chaque interaction.",
  pillars_growth_t: "Croissance",
  pillars_growth_d: "Développe ton réseau, débloque des fonctionnalités et atteins plus de la communauté.",

  events_h2: "Conçu pour la communauté mondiale de la danse",
  events_sub: "Explore des événements en direct dans les grandes villes de danse.",
  events_attending: "présents",
  events_best_of: "Le meilleur de",
  events_empty_title: "Pas encore d'événements en direct à mettre en avant.",
  events_empty_sub: "Explore la page des événements pour voir ce qui sera publié prochainement.",
  events_cta: "Voir tous les événements",

  safety_h2: "Confiance à travers la communauté.",
  safety_sub: "Nous avons construit ConXion avec la sécurité au cœur, centrée sur le respect mutuel.",
  safety_ref: "Système de références",
  safety_verified: "Profils vérifiés",
  safety_guidelines: "Règles de sécurité",
  safety_report: "Outils de signalement",
  safety_quote: "\"ConXion m'a permis de voyager à Rome et de me sentir en sécurité dès le premier jour en trouvant des locaux.\"",
  safety_quote_author: "— Maria S., Bachatera",

  final_h2: "Prêt à construire ton réseau de danse ?",
  final_cta: "Rejoindre ConXion",

  footer_company: "Entreprise",
  footer_trust: "Confiance",
  footer_help: "Aide",
  footer_social: "Réseaux",
  footer_tagline: "Connecter la communauté mondiale de la danse par la confiance et le mouvement.",

  welcome_h1: "Bienvenue sur ConXion",
  welcome_sub: "La communauté mondiale de la danse. Trouve des danseurs, planifie des voyages, accueille des voyageurs et fais grandir ta scène.",
  welcome_cta: "Commencer",
  welcome_already: "Déjà un compte ? Se connecter",
};

const de: Dict = {
  nav_blog: "Blog",
  nav_login: "Anmelden",
  nav_join: "ConXion beitreten",
  nav_join_short: "Beitreten",

  hero_h1_top: "Verbinde dich mit",
  hero_h1_accent: "Tänzern weltweit",
  hero_sub: "Entdecke Tänzer, reise gemeinsam und entwickle deine Tanzleidenschaft weiter.",
  hero_cta_join: "ConXion beitreten",
  hero_cta_events: "Events entdecken",

  card_teacher: "Lehrer",
  card_traveling: "Auf Reisen",
  card_attending: "Tänzer nehmen teil",
  card_refs: "Ref.",

  pillars_discovery_t: "Entdeckung",
  pillars_discovery_d: "Erkunde Events, Reisen und Tänzer in deiner Nähe.",
  pillars_connection_t: "Verbindung",
  pillars_connection_d: "Verbinde dich durch Beitreten oder Zugang anfragen.",
  pillars_interaction_t: "Interaktion",
  pillars_interaction_d: "Starte Gespräche und plane gemeinsam.",
  pillars_activity_t: "Aktivität",
  pillars_activity_d: "Verwandle Verbindungen in echte Erlebnisse.",
  pillars_reference_t: "Referenz",
  pillars_reference_d: "Teile dein Feedback nach jeder Interaktion.",
  pillars_growth_t: "Wachstum",
  pillars_growth_d: "Baue dein Netzwerk aus, schalte Funktionen frei und erreiche mehr der Community.",

  events_h2: "Für die globale Tanzgemeinschaft gebaut",
  events_sub: "Entdecke Live-Events in den wichtigsten Tanzstädten.",
  events_attending: "nehmen teil",
  events_best_of: "Das Beste aus",
  events_empty_title: "Noch keine Live-Events zum Vorstellen.",
  events_empty_sub: "Erkunde die Events-Seite, um zu sehen, was als nächstes veröffentlicht wird.",
  events_cta: "Alle Events entdecken",

  safety_h2: "Vertrauen durch die Community.",
  safety_sub: "Wir haben ConXion mit Sicherheit als Kern gebaut, basierend auf gegenseitigem Respekt.",
  safety_ref: "Referenzsystem",
  safety_verified: "Verifizierte Profile",
  safety_guidelines: "Sicherheitsrichtlinien",
  safety_report: "Meldetools",
  safety_quote: "\"ConXion ermöglichte mir, nach Rom zu reisen und mich sofort sicher zu fühlen, indem ich lokale Socials fand.\"",
  safety_quote_author: "— Maria S., Bachatera",

  final_h2: "Bereit, dein Tanznetzwerk aufzubauen?",
  final_cta: "ConXion beitreten",

  footer_company: "Unternehmen",
  footer_trust: "Vertrauen",
  footer_help: "Hilfe",
  footer_social: "Social",
  footer_tagline: "Die globale Tanzgemeinschaft durch Vertrauen und Bewegung verbinden.",

  welcome_h1: "Willkommen bei ConXion",
  welcome_sub: "Die globale Tanzgemeinschaft. Finde Tänzer, plane Reisen, beherberge Reisende und lass deine Szene wachsen.",
  welcome_cta: "Loslegen",
  welcome_already: "Bereits ein Konto? Anmelden",
};

const it: Dict = {
  nav_blog: "Blog",
  nav_login: "Accedi",
  nav_join: "Unisciti a ConXion",
  nav_join_short: "Unisciti",

  hero_h1_top: "Connettiti con",
  hero_h1_accent: "ballerini di tutto il mondo",
  hero_sub: "Scopri ballerini, viaggia insieme e fai crescere la tua passione per la danza.",
  hero_cta_join: "Unisciti a ConXion",
  hero_cta_events: "Esplora eventi",

  card_teacher: "Insegnante",
  card_traveling: "In viaggio",
  card_attending: "ballerini presenti",
  card_refs: "ref.",

  pillars_discovery_t: "Scoperta",
  pillars_discovery_d: "Esplora eventi, viaggi e ballerini vicino a te.",
  pillars_connection_t: "Connessione",
  pillars_connection_d: "Connettiti unendoti o richiedendo l'accesso.",
  pillars_interaction_t: "Interazione",
  pillars_interaction_d: "Avvia conversazioni e pianifica insieme.",
  pillars_activity_t: "Attività",
  pillars_activity_d: "Trasforma le connessioni in esperienze reali.",
  pillars_reference_t: "Referenza",
  pillars_reference_d: "Condividi il tuo feedback dopo ogni interazione.",
  pillars_growth_t: "Crescita",
  pillars_growth_d: "Espandi la tua rete, sblocca funzionalità e raggiungi più community.",

  events_h2: "Creato per la comunità globale della danza",
  events_sub: "Esplora eventi live nelle principali città della danza.",
  events_attending: "presenti",
  events_best_of: "Il meglio di",
  events_empty_title: "Nessun evento live da mostrare per ora.",
  events_empty_sub: "Esplora la pagina degli eventi per vedere cosa verrà pubblicato prossimamente.",
  events_cta: "Esplora tutti gli eventi",

  safety_h2: "Fiducia attraverso la comunità.",
  safety_sub: "Abbiamo costruito ConXion con la sicurezza al centro, basata sul rispetto reciproco.",
  safety_ref: "Sistema di referenze",
  safety_verified: "Profili verificati",
  safety_guidelines: "Linee guida sulla sicurezza",
  safety_report: "Strumenti di segnalazione",
  safety_quote: "\"ConXion mi ha permesso di viaggiare a Roma e sentirmi subito al sicuro trovando i locali.\"",
  safety_quote_author: "— Maria S., Bachatera",

  final_h2: "Pronto a costruire la tua rete di danza?",
  final_cta: "Unisciti a ConXion",

  footer_company: "Azienda",
  footer_trust: "Fiducia",
  footer_help: "Aiuto",
  footer_social: "Social",
  footer_tagline: "Connettere la comunità mondiale della danza attraverso fiducia e movimento.",

  welcome_h1: "Benvenuto su ConXion",
  welcome_sub: "La comunità globale della danza. Trova ballerini, pianifica viaggi, ospita viaggiatori e fai crescere la tua scena.",
  welcome_cta: "Inizia",
  welcome_already: "Hai già un account? Accedi",
};

const nl: Dict = {
  nav_blog: "Blog",
  nav_login: "Inloggen",
  nav_join: "Meedoen met ConXion",
  nav_join_short: "Meedoen",

  hero_h1_top: "Verbind je met",
  hero_h1_accent: "dansers wereldwijd",
  hero_sub: "Ontdek dansers, reis samen en laat je dansleven groeien.",
  hero_cta_join: "Meedoen met ConXion",
  hero_cta_events: "Verken evenementen",

  card_teacher: "Leraar",
  card_traveling: "Op reis",
  card_attending: "dansers aanwezig",
  card_refs: "ref.",

  pillars_discovery_t: "Ontdekking",
  pillars_discovery_d: "Verken evenementen, reizen en dansers bij jou in de buurt.",
  pillars_connection_t: "Verbinding",
  pillars_connection_d: "Maak verbinding door deel te nemen of toegang aan te vragen.",
  pillars_interaction_t: "Interactie",
  pillars_interaction_d: "Start gesprekken en plan samen.",
  pillars_activity_t: "Activiteit",
  pillars_activity_d: "Zet verbindingen om in echte ervaringen.",
  pillars_reference_t: "Referentie",
  pillars_reference_d: "Deel je feedback na elke interactie.",
  pillars_growth_t: "Groei",
  pillars_growth_d: "Breid je netwerk uit, ontgrendel functies en bereik meer van de community.",

  events_h2: "Gebouwd voor de wereldwijde dansgemeenschap",
  events_sub: "Verken live evenementen in de belangrijkste danssteden.",
  events_attending: "aanwezig",
  events_best_of: "Het beste van",
  events_empty_title: "Nog geen live evenementen om te tonen.",
  events_empty_sub: "Verken de evenementenpagina om te zien wat er binnenkort verschijnt.",
  events_cta: "Bekijk alle evenementen",

  safety_h2: "Vertrouwen door de community.",
  safety_sub: "We hebben ConXion gebouwd met veiligheid als kern, gebaseerd op wederzijds respect.",
  safety_ref: "Referentiesysteem",
  safety_verified: "Geverifieerde profielen",
  safety_guidelines: "Veiligheidsrichtlijnen",
  safety_report: "Meldtools",
  safety_quote: "\"ConXion stelde me in staat om naar Rome te reizen en me meteen veilig te voelen door lokale socials te vinden.\"",
  safety_quote_author: "— Maria S., Bachatera",

  final_h2: "Klaar om je dansnetwerk op te bouwen?",
  final_cta: "Meedoen met ConXion",

  footer_company: "Bedrijf",
  footer_trust: "Vertrouwen",
  footer_help: "Hulp",
  footer_social: "Sociaal",
  footer_tagline: "De wereldwijde dansgemeenschap verbinden door vertrouwen en beweging.",

  welcome_h1: "Welkom bij ConXion",
  welcome_sub: "De wereldwijde dansgemeenschap. Vind dansers, plan reizen, ontvang reizigers en laat je scene groeien.",
  welcome_cta: "Aan de slag",
  welcome_already: "Al een account? Inloggen",
};

const pl: Dict = {
  nav_blog: "Blog",
  nav_login: "Zaloguj się",
  nav_join: "Dołącz do ConXion",
  nav_join_short: "Dołącz",

  hero_h1_top: "Połącz się z",
  hero_h1_accent: "tancerzami z całego świata",
  hero_sub: "Odkryj tancerzy, podróżuj razem i rozwijaj swoją pasję do tańca.",
  hero_cta_join: "Dołącz do ConXion",
  hero_cta_events: "Przeglądaj wydarzenia",

  card_teacher: "Nauczyciel",
  card_traveling: "W podróży",
  card_attending: "tancerzy uczestniczy",
  card_refs: "ref.",

  pillars_discovery_t: "Odkrywanie",
  pillars_discovery_d: "Odkryj wydarzenia, podróże i tancerzy w pobliżu.",
  pillars_connection_t: "Połączenie",
  pillars_connection_d: "Łącz się, dołączając lub prosząc o dostęp.",
  pillars_interaction_t: "Interakcja",
  pillars_interaction_d: "Rozpocznij rozmowy i planuj razem.",
  pillars_activity_t: "Aktywność",
  pillars_activity_d: "Zamień połączenia w prawdziwe doświadczenia.",
  pillars_reference_t: "Referencja",
  pillars_reference_d: "Podziel się opinią po każdej interakcji.",
  pillars_growth_t: "Wzrost",
  pillars_growth_d: "Rozwijaj sieć, odblokowuj funkcje i docieraj do większej części społeczności.",

  events_h2: "Stworzony dla globalnej społeczności tanecznej",
  events_sub: "Przeglądaj wydarzenia na żywo w najważniejszych miastach tańca.",
  events_attending: "uczestniczy",
  events_best_of: "Najlepsze z",
  events_empty_title: "Brak wydarzeń na żywo do wyróżnienia.",
  events_empty_sub: "Przeglądaj stronę wydarzeń, aby zobaczyć, co zostanie opublikowane jako następne.",
  events_cta: "Przeglądaj wszystkie wydarzenia",

  safety_h2: "Zaufanie przez społeczność.",
  safety_sub: "Zbudowaliśmy ConXion z bezpieczeństwem w centrum, opartym na wzajemnym szacunku.",
  safety_ref: "System referencji",
  safety_verified: "Zweryfikowane profile",
  safety_guidelines: "Wytyczne bezpieczeństwa",
  safety_report: "Narzędzia zgłaszania",
  safety_quote: "\"ConXion pozwoliło mi pojechać do Rzymu i od razu poczuć się bezpiecznie znajdując lokalne socials.\"",
  safety_quote_author: "— Maria S., Bachatera",

  final_h2: "Gotowy, by zbudować swoją sieć taneczną?",
  final_cta: "Dołącz do ConXion",

  footer_company: "Firma",
  footer_trust: "Zaufanie",
  footer_help: "Pomoc",
  footer_social: "Social",
  footer_tagline: "Łącząc globalną społeczność taneczną przez zaufanie i ruch.",

  welcome_h1: "Witaj w ConXion",
  welcome_sub: "Globalna społeczność taneczna. Znajdź tancerzy, planuj podróże, goszcz podróżników i rozwijaj swoją scenę.",
  welcome_cta: "Rozpocznij",
  welcome_already: "Masz już konto? Zaloguj się",
};

const DICTS: Record<Locale, Dict> = { en, es, fr, de, it, nl, pl };

export function getT(locale: Locale): Dict {
  return DICTS[locale];
}
