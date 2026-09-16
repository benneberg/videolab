/**
 * director/shotList.js
 *
 * Shot list data model and editor.
 *
 * Each shot:
 *   { id, prompt, caption, duration, move, status, videoUrl, error }
 *
 * status: 'idle' | 'rendering' | 'done' | 'error'
 * move:   one of CAMERA_MOVES keys
 */

import { get, set } from '../../shell/storage.js';

export const CAMERA_MOVES = {
  static:    'Static',
  push_in:   'Push in',
  pull_out:  'Pull out',
  pan_right: 'Pan right',
  pan_left:  'Pan left',
  orbit:     'Orbit',
  crane_up:  'Crane up',
  crane_down:'Crane down',
  handheld:  'Handheld',
};

export const FILM_STYLES = {
  auto:          'Auto',
  cinematic:     'Cinematic',
  documentary:   'Documentary',
  thriller:      'Thriller',
  romance:       'Romance',
  action:        'Action',
  horror:        'Horror',
  experimental:  'Experimental',
};

let _nextId = 1;

export function createShot(overrides = {}) {
  return {
    id:       _nextId++,
    prompt:   '',
    caption:  '',
    duration: 5,
    move:     'static',
    status:   'idle',
    videoUrl: null,
    error:    null,
    ...overrides,
  };
}

export class ShotList {
  constructor() {
    this._shots     = [];
    this._listeners = {};
    this._load();
  }

  // ── CRUD ──────────────────────────────────────────────────────────

  get shots() { return [...this._shots]; }
  get length() { return this._shots.length; }

  add(overrides = {}) {
    const shot = createShot(overrides);
    this._shots.push(shot);
    this._save();
    this._emit('change', this._shots);
    return shot;
  }

  update(id, patch) {
    const shot = this._find(id);
    if (!shot) return;
    Object.assign(shot, patch);
    this._save();
    this._emit('change', this._shots);
    this._emit('update', shot);
  }

  remove(id) {
    const idx = this._shots.findIndex(s => s.id === id);
    if (idx === -1) return;
    this._shots.splice(idx, 1);
    this._save();
    this._emit('change', this._shots);
  }

  move(id, direction) {
    const idx = this._shots.findIndex(s => s.id === id);
    if (idx === -1) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= this._shots.length) return;
    [this._shots[idx], this._shots[newIdx]] = [this._shots[newIdx], this._shots[idx]];
    this._save();
    this._emit('change', this._shots);
  }

  clear() {
    this._shots = [];
    this._save();
    this._emit('change', this._shots);
  }

  replace(shots) {
    _nextId = 1;
    this._shots = shots.map(s => createShot({ ...s, status: 'idle', videoUrl: null, error: null }));
    this._save();
    this._emit('change', this._shots);
  }

  // ── Queries ───────────────────────────────────────────────────────

  allDone()    { return this._shots.every(s => s.status === 'done'); }
  anyRendering() { return this._shots.some(s => s.status === 'rendering'); }
  doneCount()  { return this._shots.filter(s => s.status === 'done').length; }

  // ── Persistence ───────────────────────────────────────────────────

  _save() {
    // Don't cache videoUrls — they are object URLs that expire
    const slim = this._shots.map(({ videoUrl, ...rest }) => rest);
    set('director:shotList', slim);
  }

  _load() {
    const saved = get('director:shotList', []);
    this._shots = saved.map(s => createShot(s));
    if (this._shots.length) _nextId = Math.max(...this._shots.map(s => s.id)) + 1;
  }

  // ── Events ────────────────────────────────────────────────────────

  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return this;
  }

  _emit(event, data) {
    (this._listeners[event] ?? []).forEach(fn => fn(data));
  }

  _find(id) { return this._shots.find(s => s.id === id) ?? null; }
}
