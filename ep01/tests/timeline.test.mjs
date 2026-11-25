import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compile, frameState, modes, trackClip } from '../timeline.mjs';
import { parseChord, parseNote, tuning } from '../vendor/tokyo/theory.mjs';
import { midiAt } from '../vendor/tokyo/vendor/fret-note/music.mjs';

const project = JSON.parse(readFileSync(new URL('../config/scenes.json', import.meta.url)));
const model = compile(project);
const chordAt = (frame) => frameState(model, frame / 60).bar.chord?.symbol;

test('56-second sample changes chords and transitions on the expected output frames', () => {
  assert.equal(model.frames, 3360);
  assert.deepEqual(model.scenes.map(scene => scene.startFrame), [0, 960, 1920]);
  for (const [time, before, after] of [
    [8, 'Em7', 'Am7'], [16, 'Am7', 'Em7'], [24, 'Em7', 'A7'], [32, 'A7', 'Am7'],
    [36, 'Am7', 'A7'], [40, 'A7', undefined], [48, undefined, 'A7'], [52, 'A7', 'Em7'],
  ]) {
    assert.equal(chordAt(time * 60 - 1), before);
    assert.equal(chordAt(time * 60), after);
  }
  assert.equal(chordAt(3360), 'Em7');
  assert.equal(frameState(model, 40).bar.mode, modes.aeolian);
  assert.equal(frameState(model, 44).bar.mode, modes.dorian);
});

test('scenes can be selected or reordered without drifting their local bars and cues', () => {
  const subset = compile(project, {}, ['SC_04']);
  assert.equal(subset.frames, 1440);
  assert.equal(frameState(subset, 16).cue.view, 'tritone');
  const reordered = compile({ ...project, scenes: project.scenes.toReversed() });
  assert.deepEqual(reordered.scenes.map(scene => scene.startFrame), [0, 1440, 2400]);
  assert.equal(frameState(reordered, 24).scene.id, 'SC_03');
  assert.throws(() => compile(project, {}, ['SC_99']), /场景 ID/);
});

test('mode, chord, position and tritone have matching pitch evidence', () => {
  assert.deepEqual(parseChord('Em7').tones.map(tone => tone.name), ['E', 'G', 'B', 'D']);
  assert.deepEqual(parseChord('Am7').tones.map(tone => tone.name), ['A', 'C', 'E', 'G']);
  assert.deepEqual(parseChord('A7').tones.map(tone => tone.name), ['A', 'C#', 'E', 'G']);
  for (const [string, fret, name] of [[2, 0, 'B3'], [2, 1, 'C4'], [2, 2, 'C#4'], [1, 3, 'G4']]) {
    assert.equal(midiAt(tuning, string, fret), parseNote(name).midi);
  }
  assert.equal(midiAt(tuning, 1, 3) - midiAt(tuning, 2, 2), 6);
  assert.deepEqual(modes.aeolian.notes.filter(note => !modes.dorian.notes.includes(note)), ['C♮']);
  assert.deepEqual(modes.dorian.notes.filter(note => !modes.aeolian.notes.includes(note)), ['C♯']);
});

test('recorded notes require audio and distinguish confirmed frets from pitch-only alternatives', () => {
  const notes = { SC_02: [
    { track: 'guitar', time: 0.5, duration: 0.5, pitch: 'C♮4' },
    { track: 'guitar', time: 1.25, duration: 0.5, pitch: 'E4', string: 1, fret: 0 },
  ] };
  const source = { 'SC_02/guitar': { duration: 16 } };
  const sample = compile(project, notes);
  assert.equal(frameState(sample, .5).positions.some(position => position.known || position.candidate), false);
  assert.deepEqual(frameState(sample, .5, source).positions.filter(position => position.candidate)
    .map(({ string, fret }) => [string, fret]), [[2, 1], [3, 5]]);
  assert.deepEqual(frameState(sample, 1.25, source).positions.filter(position => position.known)
    .map(({ string, fret }) => [string, fret]), [[1, 0]]);
  assert.equal(frameState(sample, 1.75, source).positions.some(position => position.known), false);
  assert.equal(frameState(sample, 2, { 'SC_02/guitar': { duration: 1.25 } }).audioStatus, '实录 WAV 部分就绪');
  notes.SC_02[1].fret = 1;
  assert.throws(() => compile(project, notes), /品位不符/);
});

test('track clip and note mapping handle trims, placement, overlapping tracks and independent visual correction', () => {
  const custom = structuredClone(project);
  custom.scenes[0].audio[0].at = .25;
  custom.scenes[0].audio[0].sourceIn = .5;
  custom.scenes[0].audio.push({ id: 'lead', file: 'lead.wav', at: -.25, sourceIn: .5, gainDb: -6, noteOffset: .125, until: 1 });
  const notes = { SC_02: [{ track: 'lead', time: 1, duration: 1, pitch: 'C4', string: 2, fret: 1 }] };
  const sample = compile(custom, notes);
  const [scene] = sample.scenes;
  const [main, lead] = scene.tracks;
  assert.deepEqual(trackClip(main, scene, 16.25), { start: .25, offset: .5, end: 16 });
  assert.deepEqual(trackClip(lead, scene, 16.25), { start: 0, offset: .75, end: 1 });
  assert.equal(scene.notes[0].at, .375);
  const assets = { 'SC_02/guitar': { duration: 16.25 }, 'SC_02/lead': { duration: 16.25 } };
  assert.equal(frameState(sample, .374, assets).positions.some(position => position.known), false);
  assert.equal(frameState(sample, .375, assets).positions.some(position => position.known), true);
  assert.equal(frameState(sample, 1, assets).positions.some(position => position.known), false);
});
