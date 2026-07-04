import {
  createUserManager,
  type UserManager,
} from "@/server/identity/managers/UserManager";

// UserManagerResource — the sanctioned cross-subsystem touchpoint (ADR 0009).
// A Resource that lives in Playlist (the caller's subsystem) whose "external
// system" is Identity's UserManager (its public front door). Playlist gets a
// *fresh* access token through here rather than reading Identity's
// TokenResource directly, since a raw read can't refresh an expired token.

export interface UserManagerResource {
  getFreshAccessToken(userId: string): Promise<string>;
}

export interface UserManagerResourceDeps {
  userManager: UserManager;
}

export function makeUserManagerResource(
  deps: UserManagerResourceDeps,
): UserManagerResource {
  const { userManager } = deps;
  return {
    getFreshAccessToken(userId) {
      return userManager.getFreshAccessToken(userId);
    },
  };
}

export function createUserManagerResource(): UserManagerResource {
  return makeUserManagerResource({ userManager: createUserManager() });
}
