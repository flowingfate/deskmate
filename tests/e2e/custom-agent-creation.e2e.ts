import { test, expect } from './fixtures/electronApp';
import type { Page } from '@playwright/test';

async function openCustomAgentForm(mainWindow: Page): Promise<void> {
  await mainWindow.getByRole('button', { name: 'New Agent' }).click();
  await mainWindow.getByRole('button', { name: 'Custom Agent' }).click();
}

test.describe('Custom agent creation', () => {
  test('creates an agent without a model and opens its settings with the description', async ({ mainWindow }) => {
    await openCustomAgentForm(mainWindow);

    const nameInput = mainWindow.getByPlaceholder('Enter agent name...');
    const descriptionInput = mainWindow.locator('#agent-description');
    const createButton = mainWindow.getByRole('button', { name: 'Create and Configure Advanced Options' });

    await expect(nameInput).toBeVisible();
    await expect(descriptionInput).toBeVisible();
    await expect(createButton).toBeDisabled();

    await nameInput.fill('Configuration Agent');
    await descriptionInput.fill('Configures advanced agent options.');
    await expect(createButton).toBeEnabled();

    await Promise.all([
      mainWindow.waitForURL(/\/agent\/[^/]+\/settings\/basic$/),
      createButton.click(),
    ]);

    await expect(mainWindow.locator('#agent-description')).toHaveValue('Configures advanced agent options.');
  });

  test('creates an agent without a model and starts a new chat', async ({ mainWindow }) => {
    await openCustomAgentForm(mainWindow);

    const nameInput = mainWindow.getByPlaceholder('Enter agent name...');
    const createButton = mainWindow.getByRole('button', { name: 'Create and Start Chatting' });

    await expect(createButton).toBeDisabled();
    await nameInput.fill('Chat Agent');
    await expect(createButton).toBeEnabled();

    await Promise.all([
      mainWindow.waitForURL(/\/agent\/[^/]+\/[^/]+$/),
      createButton.click(),
    ]);
  });
});
