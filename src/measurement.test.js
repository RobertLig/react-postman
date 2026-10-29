import { getMeasurementSystem } from "./measurement";

test.each([
  ["en-US", "imperial"],
  ["my-MM", "imperial"],
  ["en-LR", "imperial"],
  ["en-GB", "metric"],
  ["en-CA", "metric"],
  ["pl-PL", "metric"],
  ["en", "metric"],
])("selects the %s measurement system from its locale", (locale, expected) => {
  expect(getMeasurementSystem(locale)).toBe(expected);
});
