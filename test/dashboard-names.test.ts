// Tool errors, prompts, skills, the docs index and the listings name dashboard screens that exist (QA 10 Nov, F5):
// the publishable key is in Dashboard → Setup → Your keys (app.straitlink.in/setup#keys), secret keys in
// Dashboard → Settings → Keys (app.straitlink.in/settings#keys). "Get started" and "Secret keys" were the old names.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const OLD = /(?:→|›|->| >)\s*\*{0,2}(?:Get started|Secret keys)\b|\bGet started\*{0,2}\s*(?:→|›|->)|\b(?:from|on|in) \*{0,2}Get started\b(?! free)/;
const files = (p: string): string[] => (statSync(p).isDirectory() ? readdirSync(p).flatMap((n) => files(join(p, n))) : [p]);

describe('dashboard screen names', () => {
  it('the pattern catches the old names and leaves the real ones alone', () => {
    for (const s of ['from Dashboard → Settings → Secret keys', 'Dashboard > Settings > Secret keys', 'Dashboard → Get started → Test mode', 'in Dashboard → Get started'])
      expect(s).toMatch(OLD);
    for (const s of ['Dashboard → Setup → Your keys', 'Dashboard > Settings > Keys', '"group": "Get started"']) expect(s).not.toMatch(OLD);
  });

  it('nothing the server sends or ships points at "Get started" or "Secret keys"', () => {
    const bad = ['src', 'skills', 'README.md', 'SECURITY.md', 'server.json', '.claude-plugin']
      .flatMap(files)
      .flatMap((f) => readFileSync(f, 'utf8').split('\n').flatMap((l, i) => (OLD.test(l) ? [`${f}:${i + 1}`] : [])));
    expect(bad).toEqual([]);
  });
});
