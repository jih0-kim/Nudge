import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { sleepyPetImageUrl, splitPetImage, withPetImage } from '../src/core/status.js';
import { Store } from '../src/core/store.js';
import { personalPetStatus } from '../src/core/personal-pet.js';
import { drawPet } from '../src/pet/draw.js';

test('public sleepy artwork is a cached PNG for each supported growth level', async () => {
  const app = createApp();
  for (const level of ['00', '01', '07', '21', '42', '66']) {
    const response = await app.request(`/pet-images/level-${level}-sleepy.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
    const png = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const cached = new Uint8Array(await (await app.request(`/pet-images/level-${level}-sleepy.png`)).arrayBuffer());
    assert.deepEqual(cached, png);
  }
  for (const path of ['level-67-sleepy.png', 'level-99-sleepy.png', 'level-1-sleepy.png', 'level-01-normal.png', 'file.svg']) {
    assert.equal((await app.request(`/pet-images/${path}`)).status, 404);
  }
  assert.match(drawPet(66, 'sleepy'), /aria-label="Sleeping"/);
  assert.notEqual(drawPet(66, 'sleepy'), drawPet(66, 'normal'));
});

test('sleeping and waking switch artwork, and only fixed public artwork URLs are accepted', (t) => {
  const saved = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = 'https://nudge.example';
  t.after(() => { if (saved === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = saved; });
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  store.trackQuest(user.id, '100.001', 'Quest: Write a test');
  const sleepy = personalPetStatus(store, user.id, true, Date.now(), 60);
  assert.equal(sleepy.imageUrl, 'https://nudge.example/pet-images/level-00-sleepy.png');
  assert.equal(splitPetImage(withPetImage(sleepy.imageUrl, 'Sleepy')).imageUrl, sleepy.imageUrl);
  for (const url of [
    'https://other.example/pet-images/level-00-sleepy.png',
    'https://nudge.example/pet-images/level-67-sleepy.png',
    'https://nudge.example/pet-images/level-00-sleepy.png?user=1',
    'https://nudge.example/apps',
  ]) assert.equal(splitPetImage(withPetImage(url, 'Untrusted')).imageUrl, undefined);
  store.completeQuest(user.id, '100.001');
  assert.ok(personalPetStatus(store, user.id, true).imageUrl.endsWith('/level-01.gif'));
  delete process.env.APP_BASE_URL;
  assert.ok(sleepyPetImageUrl(1).endsWith('/level-01.gif'));
});
