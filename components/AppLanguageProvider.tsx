"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppLanguage = "en" | "et" | "fr" | "de" | "it" | "es" | "pt";

type TranslationKey =
  | "nav.discover"
  | "nav.network"
  | "nav.messages"
  | "nav.events"
  | "nav.trips"
  | "nav.mySpace"
  | "nav.settings"
  | "nav.login"
  | "nav.join"
  | "nav.profileSettings"
  | "nav.accountSettings"
  | "nav.notifications"
  | "nav.adminConsole"
  | "nav.logout"
  | "footer.about"
  | "footer.safetyCenter"
  | "footer.support"
  | "footer.blog"
  | "footer.shop"
  | "footer.cookieSettings"
  | "footer.terms"
  | "footer.privacy"
  | "footer.language"
  | "footer.rights"
  | "discover.dancers"
  | "discover.travelers"
  | "discover.hosts"
  | "discover.filters"
  | "discover.showing";

const STORAGE_KEY = "cx-app-language-v1";

const APP_LANGUAGE_OPTIONS: Array<{ value: AppLanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "et", label: "Eesti" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
];

const DICTIONARY: Record<AppLanguage, Record<TranslationKey, string>> = {
  en: {
    "nav.discover": "Discover",
    "nav.network": "Network",
    "nav.messages": "Messages",
    "nav.events": "Events",
    "nav.trips": "Activity",
    "nav.mySpace": "My Profile",
    "nav.settings": "Settings",
    "nav.login": "Log in",
    "nav.join": "Join",
    "nav.profileSettings": "Profile settings",
    "nav.accountSettings": "Account settings",
    "nav.notifications": "Notifications",
    "nav.adminConsole": "Admin Console",
    "nav.logout": "Log out",
    "footer.about": "About",
    "footer.safetyCenter": "Safety Center",
    "footer.support": "Support",
    "footer.blog": "Blog",
    "footer.shop": "Shop",
    "footer.cookieSettings": "Cookie Settings",
    "footer.terms": "Terms",
    "footer.privacy": "Privacy",
    "footer.language": "Language",
    "footer.rights": "© 2026 ConXion. All rights reserved.",
    "discover.dancers": "Dancers",
    "discover.travelers": "Travelers",
    "discover.hosts": "Hosts",
    "discover.filters": "Filters",
    "discover.showing": "Showing",
  },
  et: {
    "nav.discover": "Avasta",
    "nav.network": "Võrgustik",
    "nav.messages": "Sõnumid",
    "nav.events": "Sündmused",
    "nav.trips": "Tegevus",
    "nav.mySpace": "Minu profiil",
    "nav.settings": "Seaded",
    "nav.login": "Logi sisse",
    "nav.join": "Liitu",
    "nav.profileSettings": "Profiili seaded",
    "nav.accountSettings": "Konto seaded",
    "nav.notifications": "Teavitused",
    "nav.adminConsole": "Admini konsool",
    "nav.logout": "Logi välja",
    "footer.about": "Meist",
    "footer.safetyCenter": "Ohutuskeskus",
    "footer.support": "Tugi",
    "footer.blog": "Blogi",
    "footer.shop": "Pood",
    "footer.cookieSettings": "Küpsiste seaded",
    "footer.terms": "Tingimused",
    "footer.privacy": "Privaatsus",
    "footer.language": "Keel",
    "footer.rights": "© 2026 ConXion. Kõik õigused kaitstud.",
    "discover.dancers": "Tantsijad",
    "discover.travelers": "Reisijad",
    "discover.hosts": "Majutajad",
    "discover.filters": "Filtrid",
    "discover.showing": "Näitan",
  },
  fr: {
    "nav.discover": "Découvrir",
    "nav.network": "Réseau",
    "nav.messages": "Messages",
    "nav.events": "Événements",
    "nav.trips": "Activité",
    "nav.mySpace": "Mon profil",
    "nav.settings": "Paramètres",
    "nav.login": "Connexion",
    "nav.join": "Rejoindre",
    "nav.profileSettings": "Paramètres du profil",
    "nav.accountSettings": "Paramètres du compte",
    "nav.notifications": "Notifications",
    "nav.adminConsole": "Console admin",
    "nav.logout": "Déconnexion",
    "footer.about": "À propos",
    "footer.safetyCenter": "Centre de sécurité",
    "footer.support": "Support",
    "footer.blog": "Blog",
    "footer.shop": "Boutique",
    "footer.cookieSettings": "Paramètres des cookies",
    "footer.terms": "Conditions",
    "footer.privacy": "Confidentialité",
    "footer.language": "Langue",
    "footer.rights": "© 2026 ConXion. Tous droits réservés.",
    "discover.dancers": "Danseurs",
    "discover.travelers": "Voyageurs",
    "discover.hosts": "Hôtes",
    "discover.filters": "Filtres",
    "discover.showing": "Affichage",
  },
  de: {
    "nav.discover": "Entdecken",
    "nav.network": "Netzwerk",
    "nav.messages": "Nachrichten",
    "nav.events": "Events",
    "nav.trips": "Aktivität",
    "nav.mySpace": "Mein Profil",
    "nav.settings": "Einstellungen",
    "nav.login": "Anmelden",
    "nav.join": "Beitreten",
    "nav.profileSettings": "Profileinstellungen",
    "nav.accountSettings": "Kontoeinstellungen",
    "nav.notifications": "Benachrichtigungen",
    "nav.adminConsole": "Admin-Konsole",
    "nav.logout": "Abmelden",
    "footer.about": "Über uns",
    "footer.safetyCenter": "Sicherheitszentrum",
    "footer.support": "Support",
    "footer.blog": "Blog",
    "footer.shop": "Shop",
    "footer.cookieSettings": "Cookie-Einstellungen",
    "footer.terms": "AGB",
    "footer.privacy": "Datenschutz",
    "footer.language": "Sprache",
    "footer.rights": "© 2026 ConXion. Alle Rechte vorbehalten.",
    "discover.dancers": "Tänzer",
    "discover.travelers": "Reisende",
    "discover.hosts": "Hosts",
    "discover.filters": "Filter",
    "discover.showing": "Anzeige",
  },
  it: {
    "nav.discover": "Scopri",
    "nav.network": "Rete",
    "nav.messages": "Messaggi",
    "nav.events": "Eventi",
    "nav.trips": "Attività",
    "nav.mySpace": "Il mio profilo",
    "nav.settings": "Impostazioni",
    "nav.login": "Accedi",
    "nav.join": "Iscriviti",
    "nav.profileSettings": "Impostazioni profilo",
    "nav.accountSettings": "Impostazioni account",
    "nav.notifications": "Notifiche",
    "nav.adminConsole": "Console admin",
    "nav.logout": "Esci",
    "footer.about": "Informazioni",
    "footer.safetyCenter": "Centro sicurezza",
    "footer.support": "Supporto",
    "footer.blog": "Blog",
    "footer.shop": "Shop",
    "footer.cookieSettings": "Impostazioni cookie",
    "footer.terms": "Termini",
    "footer.privacy": "Privacy",
    "footer.language": "Lingua",
    "footer.rights": "© 2026 ConXion. Tutti i diritti riservati.",
    "discover.dancers": "Ballerini",
    "discover.travelers": "Viaggiatori",
    "discover.hosts": "Host",
    "discover.filters": "Filtri",
    "discover.showing": "Mostra",
  },
  es: {
    "nav.discover": "Descubrir",
    "nav.network": "Red",
    "nav.messages": "Mensajes",
    "nav.events": "Eventos",
    "nav.trips": "Actividad",
    "nav.mySpace": "Mi perfil",
    "nav.settings": "Ajustes",
    "nav.login": "Iniciar sesión",
    "nav.join": "Unirse",
    "nav.profileSettings": "Ajustes del perfil",
    "nav.accountSettings": "Ajustes de la cuenta",
    "nav.notifications": "Notificaciones",
    "nav.adminConsole": "Consola admin",
    "nav.logout": "Cerrar sesión",
    "footer.about": "Acerca de",
    "footer.safetyCenter": "Centro de seguridad",
    "footer.support": "Soporte",
    "footer.blog": "Blog",
    "footer.shop": "Tienda",
    "footer.cookieSettings": "Ajustes de cookies",
    "footer.terms": "Términos",
    "footer.privacy": "Privacidad",
    "footer.language": "Idioma",
    "footer.rights": "© 2026 ConXion. Todos los derechos reservados.",
    "discover.dancers": "Bailarines",
    "discover.travelers": "Viajeros",
    "discover.hosts": "Hosts",
    "discover.filters": "Filtros",
    "discover.showing": "Mostrando",
  },
  pt: {
    "nav.discover": "Descobrir",
    "nav.network": "Rede",
    "nav.messages": "Mensagens",
    "nav.events": "Eventos",
    "nav.trips": "Atividade",
    "nav.mySpace": "Meu perfil",
    "nav.settings": "Definições",
    "nav.login": "Entrar",
    "nav.join": "Juntar-se",
    "nav.profileSettings": "Definições do perfil",
    "nav.accountSettings": "Definições da conta",
    "nav.notifications": "Notificações",
    "nav.adminConsole": "Console admin",
    "nav.logout": "Sair",
    "footer.about": "Sobre",
    "footer.safetyCenter": "Centro de segurança",
    "footer.support": "Suporte",
    "footer.blog": "Blog",
    "footer.shop": "Loja",
    "footer.cookieSettings": "Definições de cookies",
    "footer.terms": "Termos",
    "footer.privacy": "Privacidade",
    "footer.language": "Idioma",
    "footer.rights": "© 2026 ConXion. Todos os direitos reservados.",
    "discover.dancers": "Dançarinos",
    "discover.travelers": "Viajantes",
    "discover.hosts": "Hosts",
    "discover.filters": "Filtros",
    "discover.showing": "A mostrar",
  },
};

type AppLanguageContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  t: (key: TranslationKey) => string;
  options: Array<{ value: AppLanguage; label: string }>;
};

const AppLanguageContext = createContext<AppLanguageContextValue | null>(null);

function getInitialLanguage(): AppLanguage {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "en" || stored === "et" || stored === "fr" || stored === "de" || stored === "it" || stored === "es" || stored === "pt"
      ? stored
      : "en";
  } catch {
    return "en";
  }
}

export function AppLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(getInitialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // ignore localStorage errors
    }
  }, [language]);

  const value = useMemo<AppLanguageContextValue>(
    () => ({
      language,
      setLanguage: (nextLanguage) => setLanguageState(nextLanguage),
      t: (key) => DICTIONARY[language][key] ?? DICTIONARY.en[key] ?? key,
      options: APP_LANGUAGE_OPTIONS,
    }),
    [language]
  );

  return <AppLanguageContext.Provider value={value}>{children}</AppLanguageContext.Provider>;
}

export function useAppLanguage() {
  const context = useContext(AppLanguageContext);
  if (!context) {
    throw new Error("useAppLanguage must be used within AppLanguageProvider");
  }
  return context;
}
