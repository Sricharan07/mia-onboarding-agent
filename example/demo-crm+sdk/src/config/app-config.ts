import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "hiringbae",
  version: packageJson.version,
  copyright: `© ${currentYear}, hiringbae CRM .`,
  meta: {
    title: "hiringbae CRM - Modern Next.js Dashboard Starter Template",
    description:
      "hiringbae CRM is a modern, open-source dashboard starter template built with Next.js 16, Tailwind CSS v4, and shadcn/ui. Perfect for SaaS apps, admin panels, and internal tools—fully customizable and production-ready.",
  },
};
