import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import { studyDemo, synthStudy } from '../../../examples/study-demo.mjs';
import { createV2Stage } from '../v2-stage.mjs';
import { analyze } from '../v2/dsp.mjs';
import { lessons, songs, tuning } from '../part2/lesson.mjs';

test('the local case-study timeline preserves eight excerpts and their source anchors', () => {
  assert.equal(lessons.length, 8);
  assert.deepEqual([...new Set(lessons.map((lesson) => lesson.song))], Object.keys(songs));
  for (const lesson of lessons) {
    assert.equal(lesson.audioMode, 'external_audio');
    assert.equal(lesson.sourceInMs, lesson.barStartsMs[0]);
    assert.ok(lesson.barStartsMs.every((ms, i, bars) => i === 0 || ms > bars[i - 1]));
    assert.equal(lesson.harmony.at(-1).end, lesson.durationMs);
  }
  assert.equal(lessons.reduce((sum, lesson) => sum + lesson.durationMs, 0), 285000);
});

test('the synthetic fret attacks share the audio clock, and A7 exposes C-sharp', () => {
  const { model, events } = studyDemo();
  const scene = model.scenes[0];
  const local = events.filter((event) => event.excerptId === scene.excerptId);
  const time = 2000; // The second chord's guitar attack.
  const note = local.find((event) => event.part === 'guitar' && event.startMs === time);
  assert.equal(note.midi, tuning[note.string - 1] + note.fret);
  assert.equal(note.midi % 12, 1);
  const pianoOnly = synthStudy(local.filter((event) => event.part === 'piano'), scene.endMs);
  const full = synthStudy(local, scene.endMs);
  const sample = time * 96;
  assert.deepEqual(full.slice(sample - 100, sample + 2), pianoOnly.slice(sample - 100, sample + 2));
  assert.notDeepEqual(full.slice(sample + 2, sample + 100), pianoOnly.slice(sample + 2, sample + 100));
  const left = full.filter((_, i) => i % 2 === 0);
  const right = full.filter((_, i) => i % 2 === 1);
  const { frames } = analyze(left, right, 48000, model.fps);
  assert.ok(frames[65].chroma[1] > 0.65);
  assert.ok(frames[112].chroma[0] > 0.65);

  const canvas = createCanvas(1920, 1080);
  const draw = createV2Stage(model, { frames, studyEvents: events }, canvas);
  const ctx = canvas.getContext('2d');
  const goldPixels = (x, y, width, height) => {
    const { data } = ctx.getImageData(x, y, width, height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 255 && data[i + 1] === 208 && data[i + 2] === 128) count++;
    }
    return count;
  };
  draw(time - 30);
  const idleFret = goldPixels(130, 330, 1660, 260);
  draw(time + 100);
  assert.ok(goldPixels(130, 330, 1660, 260) > idleFret + 100);
  assert.ok(goldPixels(263, 635, 70, 275) > 100);
});
