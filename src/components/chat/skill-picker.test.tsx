import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkillPicker } from "@/components/chat/skill-picker";
import type { Skill } from "@/lib/resources";

const skill = (name: string, description?: string): Skill => ({
  name,
  description,
  files: [{ path: "SKILL.md" }],
  loadable: true,
});

const SKILLS = [
  skill("brainstorming", "Think out loud before building"),
  skill("writing", "Long-form writing"),
  skill("reviewing", "Review a diff"),
];

function setup(overrides: Partial<Parameters<typeof SkillPicker>[0]> = {}) {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(
    <SkillPicker
      open
      skills={SKILLS}
      loading={false}
      error={null}
      onAdd={onAdd}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onAdd, onClose };
}

describe("SkillPicker", () => {
  it("lists every skill", () => {
    setup();
    expect(screen.getByText("brainstorming")).toBeInTheDocument();
    expect(screen.getByText("writing")).toBeInTheDocument();
    expect(screen.getByText("reviewing")).toBeInTheDocument();
  });

  it("searches by name and description", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("Search skills"), "think");
    expect(screen.getByText("brainstorming")).toBeInTheDocument();
    expect(screen.queryByText("writing")).not.toBeInTheDocument();
  });

  it("takes several skills at once, which is the point of the dialog", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();

    await user.click(screen.getByText("brainstorming"));
    await user.click(screen.getByText("writing"));
    expect(screen.getByText("2 picked")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add 2 skills/i }));
    expect(onAdd).toHaveBeenCalledWith(["brainstorming", "writing"]);
  });

  it("unticks on a second click", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();

    await user.click(screen.getByText("brainstorming"));
    await user.click(screen.getByText("brainstorming"));
    await user.click(screen.getByText("writing"));

    await user.click(screen.getByRole("button", { name: /add skill/i }));
    expect(onAdd).toHaveBeenCalledWith(["writing"]);
  });

  it("cannot be confirmed with nothing picked", () => {
    setup();
    // The label counts what was ticked, so the empty state reads "Add 0 skills".
    expect(screen.getByRole("button", { name: /add \d+ skills?/i })).toBeDisabled();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("says when there is nothing to pick rather than showing a blank box", () => {
    setup({ skills: [] });
    expect(screen.getByText("This server reported no skills.")).toBeInTheDocument();
  });

  it("reports a failed load instead of implying there are no skills", () => {
    setup({ skills: [], error: "could not load skills" });
    expect(screen.getByText("could not load skills")).toBeInTheDocument();
  });

  it("renders nothing at all when closed", () => {
    const { container } = render(
      <SkillPicker open={false} skills={SKILLS} loading={false} error={null} onAdd={() => {}} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
