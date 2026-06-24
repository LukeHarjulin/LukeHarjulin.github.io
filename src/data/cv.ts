import cvData from "./cv.json";

export type SocialKind = "github" | "linkedin" | "codewars";

export const navItems = cvData.navItems;
export const profile = cvData.profile as typeof cvData.profile & {
	links: Array<(typeof cvData.profile.links)[number] & { kind: SocialKind }>;
};
export const metrics = cvData.metrics;
export const impactHighlights = cvData.impactHighlights;
export const skillGroups = cvData.skillGroups;
export const certifications = cvData.certifications;
export const experience = cvData.experience;
export const education = cvData.education;
export const toolkitRows = cvData.toolkitRows;
