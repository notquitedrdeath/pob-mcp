import { SkillGemService } from "../../src/services/skillGemService.js";
import {
  parseSkills,
  baseGemName,
  gemLabel,
  socketGroupLabel,
} from "../../src/services/skillParser.js";

/**
 * A build with three skill sets whose ids are deliberately not in document
 * order — which is the normal case, and the reason reading `activeSkillSet` as
 * a position picks the wrong set.
 */
const multiSet = {
  Build: { className: "Witch", mainSocketGroup: "2" },
  Skills: {
    activeSkillSet: "7",
    SkillSet: [
      {
        id: "3",
        title: "Level 1-30",
        Skill: [
          {
            enabled: "true",
            slot: "Weapon 1",
            Gem: [{ nameSpec: "Smite", skillId: "Smite", level: "4", quality: "0" }],
          },
        ],
      },
      {
        id: "7",
        title: "Endgame",
        Skill: [
          { label: "<< Damage >>" },
          {
            enabled: "true",
            slot: "Body Armour",
            mainActiveSkill: "1",
            Gem: [
              { nameSpec: "Lightning Tendrils of Escalation", skillId: "LightningTendrilsAltY", level: "21", quality: "23" },
              { nameSpec: "Inspiration", skillId: "SupportInspiration", level: "20", quality: "20" },
              { nameSpec: "Annihilation", skillId: "SupportAnnhilation", level: "4", quality: "20", enabled: "false" },
            ],
          },
        ],
      },
      { id: "1", title: "Levelling spare", Skill: [] },
    ],
  },
};

describe("skillParser — choosing the set", () => {
  it("resolves activeSkillSet as an id, not a position", () => {
    // Set id 7 sits at position 2. Treating the selector as an index would
    // return "Levelling spare" and analyse the wrong gems entirely.
    const parsed = parseSkills(multiSet as any);
    expect(parsed.activeSet?.id).toBe("7");
    expect(parsed.activeSet?.title).toBe("Endgame");
    expect(parsed.activeSet?.index).toBe(2);
    expect(parsed.activeSetResolvedBy).toBe("id");
  });

  it("says so when the id matches no set rather than picking one quietly", () => {
    const orphaned = { ...multiSet, Skills: { ...multiSet.Skills, activeSkillSet: "99" } };
    const parsed = parseSkills(orphaned as any);
    expect(parsed.activeSetResolvedBy).toBe("fallback");
    expect(parsed.activeSet?.id).toBe("3");
  });

  it("reads a legacy file with a bare Skill list and no SkillSet", () => {
    // SkillsTab.lua:551 synthesises set 1 for this shape.
    const legacy = {
      Build: {},
      Skills: {
        Skill: [{ enabled: "true", Gem: [{ nameSpec: "Fireball", level: "20", quality: "0" }] }],
      },
    };
    const parsed = parseSkills(legacy as any);
    expect(parsed.sets).toHaveLength(1);
    expect(parsed.activeSet?.groups[0].gems[0].name).toBe("Fireball");
  });
});

describe("skillParser — choosing the group and skill", () => {
  it("resolves mainSocketGroup as a 1-based index into the active set", () => {
    const parsed = parseSkills(multiSet as any);
    expect(parsed.mainSocketGroup?.index).toBe(2);
    expect(parsed.mainSocketGroup?.slot).toBe("Body Armour");
    expect(parsed.mainSkill?.name).toBe("Lightning Tendrils of Escalation");
  });

  it("accepts mainSkillIndex, the legacy alias", () => {
    const legacy = { ...multiSet, Build: { className: "Witch", mainSkillIndex: "2" } };
    expect(parseSkills(legacy as any).mainSocketGroup?.index).toBe(2);
  });

  it("indexes mainActiveSkill over active skills, not over all gems", () => {
    // An aura link commonly leads with Enlighten. Taking gems[0] as the active
    // skill reports a support gem as the build's skill.
    const auraLink = {
      Build: { mainSocketGroup: "1" },
      Skills: {
        activeSkillSet: "1",
        SkillSet: [
          {
            id: "1",
            Skill: [
              {
                enabled: "true",
                slot: "Boots",
                mainActiveSkill: "2",
                Gem: [
                  { nameSpec: "Enlighten", skillId: "SupportEnlighten", level: "3", quality: "0" },
                  { nameSpec: "Discipline", skillId: "Discipline", level: "21", quality: "0" },
                  { nameSpec: "Zealotry", skillId: "Zealotry", level: "21", quality: "0" },
                ],
              },
            ],
          },
        ],
      },
    };
    const parsed = parseSkills(auraLink as any);
    expect(parsed.mainSocketGroup?.gems[0].name).toBe("Enlighten");
    expect(parsed.mainSocketGroup?.activeSkills.map((g) => g.name)).toEqual([
      "Discipline",
      "Zealotry",
    ]);
    // mainActiveSkill 2 is the second *active* skill.
    expect(parsed.mainSkill?.name).toBe("Zealotry");
  });

  it("treats a group with a label and no gems as a section header", () => {
    const parsed = parseSkills(multiSet as any);
    const header = parsed.activeSet!.groups[0];
    expect(header.isLabelOnly).toBe(true);
    expect(header.label).toBe("<< Damage >>");
    expect(socketGroupLabel(header)).toContain("label only");
  });
});

describe("skillParser — gem fields", () => {
  const group = () => parseSkills(multiSet as any).mainSocketGroup!;

  it("separates supports from active skills by skillId", () => {
    expect(group().gems.map((g) => g.isSupport)).toEqual([false, true, true]);
  });

  it("keeps a disabled gem but marks it", () => {
    const annihilation = group().gems.find((g) => g.name === "Annihilation")!;
    expect(annihilation.enabled).toBe(false);
    expect(gemLabel(annihilation)).toContain("[disabled]");
  });

  it("defaults an absent gem enabled to true, and a socket group to false", () => {
    // SkillsTab.lua is deliberately asymmetric here: line 498 for gems, line
    // 447 for socket groups.
    const bare = {
      Build: {},
      Skills: {
        activeSkillSet: "1",
        SkillSet: [{ id: "1", Skill: [{ Gem: [{ nameSpec: "Fireball", level: "1", quality: "0" }] }] }],
      },
    };
    const parsed = parseSkills(bare as any);
    expect(parsed.activeSet?.groups[0].gems[0].enabled).toBe(true);
    expect(parsed.activeSet?.groups[0].enabled).toBe(false);
  });

  it("defaults enableGlobal1 to true and enableGlobal2 to false", () => {
    const gem = group().gems[0];
    expect(gem.enableGlobal1).toBe(true);
    expect(gem.enableGlobal2).toBe(false);
  });

  it("derives a name from skillId when nameSpec is empty", () => {
    // Skills granted outside the gem list carry no nameSpec; PoB fills them in
    // from its gem database, which we do not have offline.
    const granted = {
      Build: {},
      Skills: {
        activeSkillSet: "1",
        SkillSet: [
          {
            id: "1",
            Skill: [
              {
                enabled: "true",
                Gem: [
                  {
                    nameSpec: "",
                    skillId: "SummonSpectralTiger",
                    skillMinion: "SummonedSpectralTiger",
                    level: "20",
                    quality: "0",
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const gem = parseSkills(granted as any).activeSet!.groups[0].gems[0];
    expect(gem.name).toBe("Summon Spectral Tiger");
    expect(gem.nameDerived).toBe(true);
    expect(gem.minion).toBe("SummonedSpectralTiger");
  });

  it("accepts a name attribute, which PoB never writes but fixtures use", () => {
    const fixture = {
      Build: {},
      Skills: {
        activeSkillSet: "1",
        SkillSet: [{ id: "1", Skill: [{ enabled: "true", Gem: [{ name: "Tornado Shot", level: "21", quality: "23" }] }] }],
      },
    };
    expect(parseSkills(fixture as any).activeSet?.groups[0].gems[0].name).toBe("Tornado Shot");
  });
});

describe("baseGemName", () => {
  it("strips a transfigured suffix so tag lookups find the base gem", () => {
    expect(baseGemName("Lightning Tendrils of Escalation")).toBe("Lightning Tendrils");
    expect(baseGemName("Fireball")).toBe("Fireball");
  });
});

describe("analyze_skill_links regression", () => {
  it("analyses the build's main skill, not the first levelling gem", () => {
    // The reported symptom: a character whose main skill is a six-link reported
    // a two-link levelling gem, because every skill set was flattened into one
    // list and index 0 landed on whichever sorted first.
    const analysis = new SkillGemService().analyzeSkillLinks(multiSet as any);
    expect(analysis.activeSkill.name).toBe("Lightning Tendrils of Escalation");
    expect(analysis.context.skillSetTitle).toBe("Endgame");
    expect(analysis.context.chosenBy).toBe("main-socket-group");
    // Smite is in a different skill set and must not appear.
    expect(analysis.supports.map((s) => s.name)).not.toContain("Smite");
  });

  it("counts links by enabled gems, so a parked spare is not an extra link", () => {
    const analysis = new SkillGemService().analyzeSkillLinks(multiSet as any);
    // Three gems, one disabled.
    expect(analysis.linkCount).toBe(2);
    expect(analysis.supports.find((s) => s.name === "Annihilation")?.enabled).toBe(false);
  });

  it("reports the group number when one is asked for explicitly", () => {
    const analysis = new SkillGemService().analyzeSkillLinks(multiSet as any, 2);
    expect(analysis.context.groupIndex).toBe(2);
    expect(analysis.context.chosenBy).toBe("explicit");
  });

  it("refuses a group number that has no gems, listing the ones that do", () => {
    // Group 1 of the active set is a section header.
    expect(() => new SkillGemService().analyzeSkillLinks(multiSet as any, 1)).toThrow(
      /No socket group 1 with gems/
    );
  });
});
