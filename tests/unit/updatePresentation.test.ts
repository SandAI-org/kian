import { describe, expect, it } from "vitest";

import { getAboutUpdatePresentation } from "../../src/renderer/modules/settings/updatePresentation";
import type { AppUpdateStatusDTO } from "../../src/shared/types";

const createStatus = (
  overrides: Partial<AppUpdateStatusDTO>,
): AppUpdateStatusDTO => ({
  stage: "idle",
  currentVersion: "0.1.0",
  ...overrides,
});

describe("getAboutUpdatePresentation", () => {
  it("hides the progress bar when the app is already up to date", () => {
    const presentation = getAboutUpdatePresentation(
      createStatus({
        stage: "upToDate",
        latestVersion: "0.1.0",
        progressPercent: 0,
      }),
    );

    expect(presentation.showProgress).toBe(false);
    expect(presentation.showLatestVersion).toBe(false);
    expect(presentation.progressPercent).toBe(0);
  });

  it("shows a full progress state after the update package is downloaded", () => {
    const presentation = getAboutUpdatePresentation(
      createStatus({
        stage: "downloaded",
        latestVersion: "0.1.1",
        progressPercent: 12,
      }),
    );

    expect(presentation.canInstallUpdate).toBe(true);
    expect(presentation.showProgress).toBe(true);
    expect(presentation.showLatestVersion).toBe(true);
    expect(presentation.progressPercent).toBe(100);
  });
});
