/* Focused regressions for the native job selector and model configuration state. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const base = process.env.E2E_URL || 'http://127.0.0.1:8011';

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PW_CHANNEL === 'chromium' ? undefined : process.env.PW_CHANNEL || 'msedge',
    headless: true
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route('**/api/llm/config', route => {
      const config = route.request().method() === 'GET'
        ? { provider: 'openai', adapter: 'openai-responses', base_url: 'https://api.openai.com/v1', model: 'existing-model', configured: true, has_api_key: true }
        : { provider: 'openai', adapter: 'openai-responses', base_url: 'https://api.openai.com/v1', model: 'mock-model', configured: true, has_api_key: true };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) });
    });
    await page.goto(base);
    assert.equal(await page.locator('.singularity-intro').count(), 0, 'the removed cosmic intro must not render');
    await page.locator('.exploration-header').waitFor();

    const workflowModal = page.getByRole('dialog', { name: '先确认流程与保存方式', exact: true });
    await workflowModal.waitFor();
    const autosaveButton = workflowModal.getByRole('button', { name: '继续并自动保存', exact: true });
    if (await autosaveButton.isEnabled()) {
      await autosaveButton.click();
    } else {
      await workflowModal.getByRole('button', { name: '关闭自动保存并继续', exact: true }).click();
    }
    await workflowModal.waitFor({ state: 'detached' });

    await page.getByRole('tab', { name: /能力档案/ }).click();
    await page.getByRole('tab', { name: '手动录入资料', exact: true }).click();
    console.log('资料页诊断:', JSON.stringify({
      url: page.url(),
      targetSelectorCount: await page.locator('.profile-target-select').count(),
      profileText: (await page.locator('#page-profile').innerText()).slice(0, 500)
    }));
    const targetJob = page.locator('.profile-target-select select');
    await targetJob.selectOption('java');
    const optionStyle = await targetJob.locator('option').nth(1).evaluate(option => {
      const style = getComputedStyle(option);
      return { color: style.color, backgroundColor: style.backgroundColor, colorScheme: style.colorScheme };
    });
    console.log('目标岗位选项样式:', JSON.stringify(optionStyle));
    assert.equal(optionStyle.color, 'rgb(243, 244, 246)', '目标岗位选项文字应有足够对比度');
    assert.equal(optionStyle.backgroundColor, 'rgb(24, 24, 29)', '目标岗位下拉菜单应使用深色背景');

    await page.getByRole('button', { name: /AI 模型配置/ }).click();
    const dialog = page.getByRole('dialog', { name: 'AI 模型配置' });
    await dialog.waitFor();
    const state = (await dialog.locator('.ai-config-state').innerText()).trim();
    console.log('模型配置状态:', state);
    assert.match(state, /尚未验证/, '填写配置不应被显示为已经可用');
    const testButton = dialog.getByRole('button', { name: '测试连接' });
    const modelInput = dialog.locator('label').filter({ hasText: '模型名称' }).locator('input');
    await modelInput.fill('mock-model');
    assert.equal(await testButton.isDisabled(), true, '尚未保存的配置不能直接进行连接测试');
    await dialog.getByRole('button', { name: '保存配置' }).click();
    await dialog.getByRole('status').getByText('配置已保存，连接尚未验证').waitFor();
    assert.equal(await dialog.isVisible(), true, '保存后应留在配置页，以便立即测试连接');
    await page.route('**/api/llm/test', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: true, model: 'mock-model' }) }));
    await testButton.click();
    await dialog.getByRole('status').getByText('模型连接验证成功').waitFor();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
