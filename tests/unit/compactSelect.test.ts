import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  COMPACT_DROPDOWN_OVERLAY,
} from "../../src/renderer/components/CompactDropdown";
import { CompactSelect } from "../../src/renderer/components/CompactSelect";

describe("CompactSelect", () => {
  it("marks dropdown overlays as non-draggable for Electron windows", () => {
    expect(COMPACT_DROPDOWN_OVERLAY.split(" ")).toContain("no-drag");
  });

  it("marks the trigger button as non-draggable", () => {
    const markup = renderToStaticMarkup(
      createElement(CompactSelect, {
        value: "medium",
        options: [
          { label: "Low", value: "low" },
          { label: "Medium", value: "medium" },
          { label: "High", value: "high" },
        ],
      }),
    );

    expect(markup).toContain("compact-select-trigger");
    expect(markup).toContain("no-drag");
  });

  it("renders the selected option label in the trigger", () => {
    const markup = renderToStaticMarkup(
      createElement(CompactSelect, {
        value: "medium",
        options: [
          { label: "Low", value: "low" },
          { label: "Medium", value: "medium" },
          { label: "High", value: "high" },
        ],
      }),
    );

    expect(markup).toContain("Medium");
  });
});
