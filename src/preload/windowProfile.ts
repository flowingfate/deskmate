const PROFILE_ID_ARGUMENT_PREFIX = '--deskmate-profile-id=';

function readProfileId(): string {
  const argument = process.argv.find((value) => value.startsWith(PROFILE_ID_ARGUMENT_PREFIX));
  const profileId = argument?.slice(PROFILE_ID_ARGUMENT_PREFIX.length);
  if (!profileId) {
    throw new Error('Main window profile identity is unavailable.');
  }
  return profileId;
}

/** BrowserWindow creation injects this immutable identity before preload executes. */
export const profile = {
  id: readProfileId(),
};
