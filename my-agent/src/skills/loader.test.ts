import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { SkillsLoader } from "./loader.js";

const WORKSPACE = join(process.cwd(), "temp-test-workspace");
const SKILLS_DIR = join(WORKSPACE, "skills");

describe("SkillsLoader", () => {
  beforeAll(async () => {
    await mkdir(SKILLS_DIR, { recursive: true });

    // Create a mock skill directory
    const skillADir = join(SKILLS_DIR, "skill-a");
    await mkdir(skillADir);
    await writeFile(
      join(skillADir, "SKILL.md"),
      `---
name: skill-a
description: >
  This is a multiline
  description for skill-a.
tags: [tag1, tag2]
---
# Skill A Content
`
    );

    // Create another mock skill
    const skillBDir = join(SKILLS_DIR, "skill-b");
    await mkdir(skillBDir);
    await writeFile(
      join(skillBDir, "SKILL.md"),
      `---
name: skill-b
description: Simple description
tags:
  - tag3
  - tag4
---
# Skill B Content
`
    );
  });

  afterAll(async () => {
    await rm(WORKSPACE, { recursive: true, force: true });
  });

  it("discovers skills and parses frontmatter", async () => {
    const loader = new SkillsLoader(WORKSPACE);
    const skills = await loader.discover();

    expect(skills).toHaveLength(2);

    const a = skills.find((s) => s.name === "skill-a");
    expect(a).toBeDefined();
    expect(a?.description).toContain("multiline description");
    expect(a?.tags).toEqual(["tag1", "tag2"]);
    expect(a?.path).toBe("skills/skill-a/SKILL.md");

    const b = skills.find((s) => s.name === "skill-b");
    expect(b).toBeDefined();
    expect(b?.description).toBe("Simple description");
    expect(b?.tags).toEqual(["tag3", "tag4"]);
    expect(b?.path).toBe("skills/skill-b/SKILL.md");
  });

  it("handles missing skills directory gracefully", async () => {
    const loader = new SkillsLoader(WORKSPACE, ["nonexistent"]);
    const skills = await loader.discover();
    expect(skills).toHaveLength(0);
  });
});
