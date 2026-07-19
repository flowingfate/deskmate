import { test, expect } from './fixtures/electronApp';

test.describe('Agent avatar emoji picker', () => {
  test('selects a searched emoji and closes the picker', async ({ mainWindow }) => {
    await mainWindow.getByRole('button', { name: 'New Agent' }).click();
    await mainWindow.getByRole('button', { name: /Custom Agent/ }).click();

    const avatarTrigger = mainWindow.getByRole('button', { name: 'Choose agent avatar' });
    await expect(avatarTrigger).toBeVisible();
    const initialEmoji = await avatarTrigger.textContent();

    await avatarTrigger.click();

    const search = mainWindow.getByRole('searchbox', { name: 'Search emoji' });
    await expect(search).toBeVisible({ timeout: 30_000 });
    const categoryToolbar = mainWindow.getByRole('toolbar', { name: 'Emoji categories' });
    await expect(categoryToolbar).toBeVisible();
    await expect(categoryToolbar.getByRole('button')).toHaveCount(9);
    await expect(mainWindow.getByRole('row').first().getByRole('gridcell')).toHaveCount(10);

    await categoryToolbar.getByRole('button', { name: 'Food & drink' }).click();
    await expect(mainWindow.locator('[frimousse-category-header]').filter({ hasText: 'Food & drink' })).toBeInViewport();
    await search.fill('grinning');

    const matchingEmoji = mainWindow.getByRole('gridcell', { name: 'Grinning face', exact: true });
    await expect(matchingEmoji).toBeVisible();
    await matchingEmoji.click();

    await expect(search).toBeHidden();
    await expect(avatarTrigger).not.toHaveText(initialEmoji ?? '');
  });
});
