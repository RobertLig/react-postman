import { render, screen } from "@testing-library/react";
import { getLocale, LocalizedText, translate } from "./i18n";

describe("frontend localization", () => {
  const originalLanguage = Object.getOwnPropertyDescriptor(navigator, "language");
  const originalLanguages = Object.getOwnPropertyDescriptor(navigator, "languages");

  afterEach(() => {
    if (originalLanguage) {
      Object.defineProperty(navigator, "language", originalLanguage);
    } else {
      delete navigator.language;
    }
    if (originalLanguages) {
      Object.defineProperty(navigator, "languages", originalLanguages);
    } else {
      delete navigator.languages;
    }
  });

  test("selects Polish for Polish browser locales and English otherwise", () => {
    Object.defineProperty(navigator, "language", { configurable: true, value: "pl-PL" });
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["pl-PL", "en-US"] });
    expect(getLocale()).toBe("pl");

    Object.defineProperty(navigator, "language", { configurable: true, value: "fr-FR" });
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["fr-FR", "en-US"] });
    expect(getLocale()).toBe("en");
  });

  test("honors Firefox preferred page languages when the browser UI is English", () => {
    Object.defineProperty(navigator, "language", { configurable: true, value: "en-US" });
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["pl-PL", "en-US"] });
    expect(getLocale()).toBe("pl");
  });

  test("localizes text, accessible labels, and placeholders", () => {
    Object.defineProperty(navigator, "language", { configurable: true, value: "pl" });
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["pl"] });
    render(
      <LocalizedText>
        <button aria-label="Dismiss notification">Post an ad</button>
        <input placeholder="A route title or description..." />
        <p data-no-translate>Messages</p>
      </LocalizedText>,
    );

    expect(screen.getByRole("button", { name: "Zamknij powiadomienie" }))
      .toHaveTextContent("Dodaj ogłoszenie");
    expect(screen.getByPlaceholderText("Tytuł lub opis trasy...")).toBeInTheDocument();
    expect(screen.getByText("Messages")).toBeInTheDocument();
  });

  test("translates dynamic listing counts with Polish plural forms", () => {
    expect(translate("1 ad", "pl")).toBe("1 ogłoszenie");
    expect(translate("3 ads", "pl")).toBe("3 ogłoszenia");
    expect(translate("12 ads", "pl")).toBe("12 ogłoszeń");
    expect(translate("12 ads", "en")).toBe("12 ads");
  });
});
