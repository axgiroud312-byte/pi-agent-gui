// Use language-independent test IDs until the native locale is selected.
// Chromium --lang does not override the application's persisted/system locale.
export async function selectNativeLocale(page, locale) {
  await page.getByTestId('task-settings-button').filter({ visible: true }).click();
  await page.getByTestId('settings-locale-select-trigger').click();
  await page.getByTestId(`settings-locale-select-item-${locale}`).click();
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('settings-page').waitFor({ state: 'hidden' });
}
