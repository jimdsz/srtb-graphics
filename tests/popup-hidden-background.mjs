import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const base = process.argv[2] || 'http://127.0.0.1:4192';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  const result = await page.evaluate(async () => {
    const module = await import('/library/v1.7.0/BTV_PopUp/graphic.mjs');
    const tag = 'test-popup-hidden-background';
    if (!customElements.get(tag)) customElements.define(tag, module.default);
    const graphic = document.createElement(tag);
    graphic.style.cssText = 'display:block;width:960px;height:540px';
    document.body.replaceChildren(graphic);
    await graphic.load({
      renderType: 'realtime',
      previewMuted: true,
      data: {
        _background_visible: false,
        _media_background_sequence: JSON.stringify([{ url: '', start: 0, end: 5 }]),
        _media_popup_url: 'lib/media/default-popup.png',
        _out_mode: 'manual'
      }
    });
    const loaded = await graphic.getStatus();
    await graphic.playAction();
    await new Promise(resolve => setTimeout(resolve, 120));
    const playing = await graphic.getStatus();
    await graphic.dispose();
    return {
      loadedPhase: loaded.phase || loaded.playStatus,
      playingPhase: playing.phase || playing.playStatus,
      backgroundVisible: playing.media?.backgroundVisible,
      popupClips: playing.media?.sequences?.popup?.count
    };
  });
  assert.equal(result.backgroundVisible, false);
  assert.equal(result.popupClips, 1);
  assert.ok(['in', 'onair', 'play'].includes(result.playingPhase), `IN non lancé : ${JSON.stringify(result)}`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
