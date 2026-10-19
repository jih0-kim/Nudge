import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { growthLevel } from '../src/pet/render.js';
import { petGifUrl } from '../src/core/status.js';
import { drawPet, stageOf } from '../src/pet/draw.js';

test('every incoming growth level has artwork and a matching GIF', () => {
  for (let level = 0; level <= 66; level++) {
    const filename = `level-${String(level).padStart(2, '0')}.gif`;
    assert.ok(existsSync(`assets/gif/${filename}`));
    assert.ok(petGifUrl(level).endsWith(`/${filename}`));
    assert.match(drawPet(level, 'normal'), /<svg/);
  }
});

test('native demo milestones select matching stage artwork and normal growth advances per quest', () => {
  const milestones = [0, 1, 7, 21, 42, 66];
  for (let stage = 0; stage <= 5; stage++) {
    assert.equal(growthLevel(stage, 66, true), milestones[stage]);
    assert.equal(stageOf(growthLevel(stage, 66, true)), stage);
  }
  assert.equal(growthLevel(2, 66, false), 2);
  assert.equal(growthLevel(3, 66, false), 3);
  assert.equal(growthLevel(33, 66, false), 33);
  assert.equal(growthLevel(1, 10, false), 7);
  assert.equal(growthLevel(100, 66, false), 66);
  assert.equal(growthLevel(-1, 66, false), 0);
});
