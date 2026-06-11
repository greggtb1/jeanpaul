export const ROLE_GROUPS: { label: string; items: string[] }[] = [
  {
    label: "Marketing & growth",
    items: ["Marketing Manager", "Growth Marketing", "Chef de projet marketing"],
  },
  {
    label: "Communication",
    items: ["Chargé de communication", "Responsable communication", "Community Manager"],
  },
  {
    label: "Product & tech",
    items: ["Product Manager", "Product Owner", "Chef de projet digital"],
  },
  {
    label: "Sales & business",
    items: ["Business Developer", "Sales Manager", "Customer Success"],
  },
  {
    label: "Ops & RH",
    items: ["Operations Manager", "HR Manager", "Chargé de recrutement"],
  },
  {
    label: "Finance & stratégie",
    items: ["Consultant", "Business Analyst", "Strategy Manager"],
  },
  {
    label: "Créatif & design",
    items: ["UX Designer", "Graphiste", "Rédacteur web"],
  },
];

export const LOCATION_SUGGESTIONS = ["Paris", "Lyon", "Remote", "Bordeaux", "Lille"];
export const CONTRACTS = ["CDI", "CDD", "Freelance", "Stage", "Alternance"];
export const REMOTE = ["Sur site", "Hybride", "Full remote"];

export type PreferencesForm = {
  target_roles: string[];
  target_locations: string[];
  contract_type: string[];
  remote_pref: string[];
  salary_min: string;
  cv_url: string;
  cv_filename: string;
  letter_tone: string;
  letter_sample: string;
};

export const EMPTY_PREFERENCES: PreferencesForm = {
  target_roles: [],
  target_locations: [],
  contract_type: [],
  remote_pref: [],
  salary_min: "",
  cv_url: "",
  cv_filename: "",
  letter_tone: "pro",
  letter_sample: "",
};

export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}
