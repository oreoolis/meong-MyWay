import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMessage } from "./chat-message";

function render(content: string, sources: Array<"profile" | "planner" | "advisor"> = []) {
  return renderToStaticMarkup(createElement(ChatMessage, {
    message: { id: "answer", role: "assistant", content, sources },
  }));
}

describe("ChatMessage sources", () => {
  it("renders available source markers inline and does not duplicate them below", () => {
    const html = render(
      "Use **strong evidence** from [Profile], then follow [Career Planner].",
      ["profile", "planner"],
    );

    expect(html).toContain("<strong>strong evidence</strong>");
    expect(html).toContain('data-source="profile"');
    expect(html).toContain('data-source="planner"');
    expect(html.indexOf("Profile")).toBeLessThan(html.indexOf("then follow"));
    expect(html).not.toContain("Answer sources");
  });

  it("keeps a marker readable when its artifact is unavailable", () => {
    expect(render("The [Industry Advisor] result is unavailable.")).toContain("[Industry Advisor]");
  });

  it("does not render raw model-provided HTML", () => {
    expect(render("Safe <script>alert('no')</script> text")).not.toContain("<script>");
  });
});
