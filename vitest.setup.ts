// Runs for every test file. The jest-dom matchers only mean anything in a DOM
// environment, but importing them under node is harmless — they simply go
// unused by the server-side suites.
import "@testing-library/jest-dom/vitest";
