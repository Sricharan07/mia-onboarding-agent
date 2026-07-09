import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "Mia Demo CRM",
  version: packageJson.version,
  copyright: `© ${currentYear}, Mia Demo CRM.`,
  meta: {
    title: "Mia Demo CRM",
    description: "A local sample CRM for testing Mia's text, voice, pointing, and reviewed workflow execution.",
  },
};
