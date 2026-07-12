import { describe, expect, it, vi } from "vitest";

import { makeUserManagerResource } from "./UserManagerResource";

describe("UserManagerResource.getFreshAccessToken", () => {
  it("delegates to UserManager.getFreshAccessToken and returns its result", async () => {
    const getFreshAccessToken = vi.fn().mockResolvedValue("fresh-token");
    const resource = makeUserManagerResource({
      userManager: {
        beginLogin: vi.fn(),
        handleCallback: vi.fn(),
        getProfile: vi.fn(),
        getFreshAccessToken,
      },
    });

    const token = await resource.getFreshAccessToken("user-1");

    expect(token).toBe("fresh-token");
    expect(getFreshAccessToken).toHaveBeenCalledWith("user-1");
  });

  it("propagates errors from UserManager", async () => {
    const error = new Error("no tokens");
    const resource = makeUserManagerResource({
      userManager: {
        beginLogin: vi.fn(),
        handleCallback: vi.fn(),
        getProfile: vi.fn(),
        getFreshAccessToken: vi.fn().mockRejectedValue(error),
      },
    });

    await expect(resource.getFreshAccessToken("user-1")).rejects.toThrow(
      "no tokens",
    );
  });
});
