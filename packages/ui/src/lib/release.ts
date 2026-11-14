declare const __DYA_BUILD_COMMIT__: string | undefined;

/**
 * The build's commit (12 hex characters), defined as `__DYA_BUILD_COMMIT__` by Terminal's
 * vite.config.ts; "unknown" when the build had no git, and undefined outside Vite builds (tests, Storybook).
 */
export const release = typeof __DYA_BUILD_COMMIT__ === "string" ? __DYA_BUILD_COMMIT__ : undefined;

/** The commit's 7-character short hash, or undefined when the build's commit is not known. */
export const shortRelease = release && release !== "unknown" ? release.slice(0, 7) : undefined;
