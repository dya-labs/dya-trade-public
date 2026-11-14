// Resolve Vitest from this workspace when jest-dom is hoisted to the repo root.
import { expect } from 'vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';
declare module 'vitest' {
  // Module augmentation requires an interface to merge Vitest matchers.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = unknown> extends TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, T> {}
}
