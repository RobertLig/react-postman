(() => {
  const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language || "en"];
  const browserLanguage = browserLanguages
    .map((language) => language.toLowerCase().split("-")[0])
    .find((language) => language === "pl" || language === "en");
  const language = browserLanguage || "en";

  document.documentElement.lang = language;
  document.querySelectorAll("[data-locale]").forEach((content) => {
    content.hidden = content.dataset.locale !== language;
  });
  document.querySelectorAll("[data-en][data-pl]").forEach((content) => {
    content.textContent = language === "pl" ? content.dataset.pl : content.dataset.en;
  });

  document.title = language === "pl"
    ? `${document.body.dataset.titlePl} — Wayline`
    : `${document.body.dataset.titleEn} — Wayline`;
})();
