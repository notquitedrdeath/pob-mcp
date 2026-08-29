/**
 * Path of Building skill set parser.
 *
 * A build stores several skill sets and points at one of them. Reading them all
 * as a single flat list answers questions about whichever levelling setup
 * happens to sort first, which is how `analyze_skill_links` came to report a
 * two-link Smite for a level 95 character.
 *
 * Three selectors have to line up, and each is stored differently:
 *
 *   - `Skills/@activeSkillSet` is an **id**, not a position (`SkillsTab.lua:569`
 *     keys `self.skillSets` by id). Ids are usually not in document order.
 *   - `Build/@mainSocketGroup` is a **1-based index** into that set's socket
 *     groups, with `mainSkillIndex` as a legacy alias (`Build.lua:986`).
 *   - `Skill/@mainActiveSkill` is a **1-based index** into the group's active
 *     skills — the non-support gems — and defaults to 1 (`SkillsTab.lua:453`).
 *
 * Defaults are taken from `SkillsTab.lua:LoadSkill` and are deliberately not
 * uniform: a gem with no `enabled` attribute is enabled, a socket group with no
 * `enabled` attribute is not.
 */
import type { PoBBuild } from "../types.js";
import { stripColourCodes } from "./itemParser.js";

/** `SupportMultistrike`, `SupportEnlighten` — PoB's ids for support gems. */
const SUPPORT_SKILL_ID = /^Support/;

export interface ParsedGem {
  /** Display name. `nameSpec` when present, else derived from `skillId`. */
  name: string;
  /**
   * True when `nameSpec` was empty and the name was derived from `skillId`.
   * PoB fills these in from its gem database; offline we split the id instead,
   * so the name is a best effort rather than PoB's own wording.
   */
  nameDerived: boolean;
  skillId?: string;
  gemId?: string;
  variantId?: string;
  level: number;
  quality: number;
  /** Absent `enabled` means enabled (`SkillsTab.lua:498`). */
  enabled: boolean;
  /** Absent means true. */
  enableGlobal1: boolean;
  /** Absent means false. */
  enableGlobal2: boolean;
  count: number;
  /** `skillMinion` — the minion this gem summons, when it summons one. */
  minion?: string;
  isSupport: boolean;
}

export interface ParsedSocketGroup {
  /** 1-based position within its skill set, which is what mainSocketGroup indexes. */
  index: number;
  /** Author's label, colour codes stripped. */
  label: string;
  slot?: string;
  /** `active="true"` or `enabled="true"`; absent means disabled. */
  enabled: boolean;
  includeInFullDPS: boolean;
  /** 1-based index into `activeSkills`. */
  mainActiveSkill: number;
  gems: ParsedGem[];
  /** Non-support gems, in order — what `mainActiveSkill` indexes. */
  activeSkills: ParsedGem[];
  /**
   * A group carrying a label but no gems. Authors use these as section headers
   * in the skills list; they are not links and have no gems to analyse.
   */
  isLabelOnly: boolean;
  /** Set when the group comes from an item rather than the gem list. */
  source?: string;
}

export interface ParsedSkillSet {
  id: string;
  title: string;
  /** 1-based document order, which is the order PoB displays them in. */
  index: number;
  groups: ParsedSocketGroup[];
  isActive: boolean;
}

export interface ParsedSkills {
  sets: ParsedSkillSet[];
  /** The set `activeSkillSet` names, or the first when it names none. */
  activeSet?: ParsedSkillSet;
  activeSkillSetId: string;
  /**
   * How the active set was chosen. "id" is the normal path; "fallback" means
   * the id matched nothing, which is worth saying out loud rather than
   * silently analysing an arbitrary set.
   */
  activeSetResolvedBy: "id" | "fallback" | "none";
  /** `Build/@mainSocketGroup` resolved against the active set. */
  mainSocketGroup?: ParsedSocketGroup;
  /** The main group's main active skill — the build's headline skill. */
  mainSkill?: ParsedGem;
}

const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Turn `SummonSpectralTiger` into `Summon Spectral Tiger`.
 *
 * Only used when `nameSpec` is empty, which happens for skills granted outside
 * the gem list. PoB resolves these from its gem database; we split the id.
 */
function nameFromSkillId(skillId: string): string {
  return skillId
    .replace(/^Support/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

function parseGem(raw: any): ParsedGem {
  // PoB writes `nameSpec`; `name` is not part of its format but appears in
  // hand-written fixtures, so accept it rather than reporting "Unknown".
  const nameSpec = stripColourCodes(String(raw.nameSpec ?? raw.name ?? ""));
  const skillId = raw.skillId ? String(raw.skillId) : undefined;
  const name = nameSpec || (skillId ? nameFromSkillId(skillId) : "Unknown");
  return {
    name,
    nameDerived: !nameSpec,
    skillId,
    gemId: raw.gemId ? String(raw.gemId) : undefined,
    variantId: raw.variantId ? String(raw.variantId) : undefined,
    level: num(raw.level, 1),
    quality: num(raw.quality, 0),
    // Absent attributes are not the same default for each of these.
    enabled: raw.enabled === undefined ? true : String(raw.enabled) === "true",
    enableGlobal1:
      raw.enableGlobal1 === undefined ? true : String(raw.enableGlobal1) === "true",
    enableGlobal2: String(raw.enableGlobal2) === "true",
    count: num(raw.count, 1),
    minion: raw.skillMinion ? String(raw.skillMinion) : undefined,
    isSupport: skillId
      ? SUPPORT_SKILL_ID.test(skillId)
      : /\bSupport$/.test(nameSpec),
  };
}

function parseSocketGroup(raw: any, index: number): ParsedSocketGroup {
  const gems = asArray(raw.Gem).map(parseGem);
  const label = stripColourCodes(String(raw.label ?? ""));
  return {
    index,
    label,
    slot: raw.slot ? String(raw.slot) : undefined,
    // Unlike gems, a socket group with neither attribute is disabled.
    enabled: String(raw.active) === "true" || String(raw.enabled) === "true",
    includeInFullDPS: String(raw.includeInFullDPS) === "true",
    mainActiveSkill: num(raw.mainActiveSkill, 1),
    gems,
    activeSkills: gems.filter((g) => !g.isSupport),
    isLabelOnly: gems.length === 0,
    source: raw.source ? String(raw.source) : undefined,
  };
}

/** Read every skill set, and resolve which one and which group are in play. */
export function parseSkills(build: PoBBuild): ParsedSkills {
  const skills: any = build.Skills;
  const activeSkillSetId = String(skills?.activeSkillSet ?? "1");

  const sets: ParsedSkillSet[] = asArray(skills?.SkillSet).map(
    (raw: any, i: number) => ({
      id: String(raw?.id ?? i + 1),
      title: stripColourCodes(String(raw?.title ?? "")) || `Skill Set ${i + 1}`,
      index: i + 1,
      groups: asArray(raw?.Skill).map((s: any, gi: number) => parseSocketGroup(s, gi + 1)),
      isActive: false,
    })
  );

  // Older files carry a bare <Skill> list with no <SkillSet> wrapper
  // (SkillsTab.lua:551 synthesises set 1 for exactly this case).
  if (sets.length === 0 && skills?.Skill) {
    sets.push({
      id: "1",
      title: "Skill Set 1",
      index: 1,
      groups: asArray(skills.Skill).map((s: any, gi: number) => parseSocketGroup(s, gi + 1)),
      isActive: false,
    });
  }

  let activeSetResolvedBy: ParsedSkills["activeSetResolvedBy"] = "none";
  let activeSet = sets.find((s) => s.id === activeSkillSetId);
  if (activeSet) {
    activeSetResolvedBy = "id";
  } else if (sets.length > 0) {
    activeSet = sets[0];
    activeSetResolvedBy = "fallback";
  }
  if (activeSet) activeSet.isActive = true;

  // mainSocketGroup indexes the active set's groups, 1-based.
  const mainIndex = num(
    (build.Build as any)?.mainSocketGroup ?? (build.Build as any)?.mainSkillIndex,
    1
  );
  const mainSocketGroup = activeSet?.groups[mainIndex - 1];
  const mainSkill =
    mainSocketGroup?.activeSkills[mainSocketGroup.mainActiveSkill - 1] ??
    mainSocketGroup?.activeSkills[0];

  return {
    sets,
    activeSet,
    activeSkillSetId,
    activeSetResolvedBy,
    mainSocketGroup,
    mainSkill,
  };
}

/**
 * The base gem behind a transfigured one: `Lightning Tendrils of Escalation`
 * becomes `Lightning Tendrils`.
 *
 * Transfigured gems (3.23+) are named `X of Y` and are separate gems, but they
 * share the base gem's tags, so a lookup keyed on base names finds nothing for
 * them and reports a lightning caster as having no tags at all.
 */
export function baseGemName(name: string): string {
  return name.replace(/ of .+$/, "");
}

/** `Multistrike 20/20`, with the markers that change what a gem does. */
export function gemLabel(gem: ParsedGem): string {
  const bits = [`${gem.name} ${gem.level}/${gem.quality}%`];
  if (!gem.enabled) bits.push("[disabled]");
  if (gem.count > 1) bits.push(`x${gem.count}`);
  if (gem.minion) bits.push(`minion=${gem.minion}`);
  return bits.join(" ");
}

/** `[Body Armour] Dominating Blow of Inspiring` — a group's one-line identity. */
export function socketGroupLabel(group: ParsedSocketGroup): string {
  const where = group.slot ? `[${group.slot}]` : "[-]";
  if (group.isLabelOnly) return `${where} ${group.label} (label only, no gems)`;
  const active = group.activeSkills.map((g) => g.name).join(", ") || "no active skill";
  const parts = [`${where} ${active}`];
  if (group.label) parts.push(`— ${group.label}`);
  if (!group.enabled) parts.push("[disabled]");
  return parts.join(" ");
}
