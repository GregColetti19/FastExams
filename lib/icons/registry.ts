import type { Icon } from "@tabler/icons-react";
import {
  IconHeartbeat, IconLungs, IconBrain, IconPill, IconVirus, IconFlask,
  IconMicroscope, IconBone, IconDna, IconStethoscope, IconVaccine, IconEye,
  IconBabyCarriage, IconActivity, IconMedicalCross,
} from "@tabler/icons-react";

/**
 * Exam identity icons. Backend returns candidate NAMES (strings); we map name→component
 * here. Never eval / dynamic-import an arbitrary name — only keys in this registry render.
 */
export const iconRegistry: Record<string, Icon> = {
  heartbeat: IconHeartbeat,
  lungs: IconLungs,
  brain: IconBrain,
  pill: IconPill,
  virus: IconVirus,
  flask: IconFlask,
  microscope: IconMicroscope,
  bone: IconBone,
  dna: IconDna,
  stethoscope: IconStethoscope,
  vaccine: IconVaccine,
  eye: IconEye,
  baby: IconBabyCarriage,
  activity: IconActivity,
};

export const DEFAULT_ICON = "activity";

export function resolveIcon(name: string | null | undefined): Icon {
  return (name && iconRegistry[name]) || iconRegistry[DEFAULT_ICON] || IconMedicalCross;
}

/**
 * Curated, muted, on-brand accents. Used ONLY for the icon chip + small identity threads,
 * never for mastery/state coloring (that stays teal-spectrum). Kept scannable on purpose.
 */
export const ACCENTS = [
  "#5b8c7e", "#7d8a5c", "#8c6f5b", "#6f7d9c", "#9c7d8a", "#5c8c8c",
  "#8a7d5c", "#7d5c8c", "#5c7d6f", "#9c8a6f",
] as const;

/** Deterministic accent from a seed string (e.g. examId) so it's stable across renders. */
export function seedAccent(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return ACCENTS[Math.abs(h) % ACCENTS.length];
}
