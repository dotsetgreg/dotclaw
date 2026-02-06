import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shellEscape } from '../dist/tools.js';

test('shellEscape wraps simple string in single quotes', () => {
  assert.equal(shellEscape('hello'), "'hello'");
});

test('shellEscape escapes single quotes', () => {
  const result = shellEscape("it's a test");
  // Should break out, add escaped quote, then re-enter: 'it'\''s a test'
  assert.ok(result.includes("'\\''"), `should contain escaped quote pattern, got: ${result}`);
});

test('shellEscape handles empty string', () => {
  assert.equal(shellEscape(''), "''");
});

test('shellEscape handles spaces', () => {
  assert.equal(shellEscape('hello world'), "'hello world'");
});

test('shellEscape prevents command substitution', () => {
  const result = shellEscape('$(rm -rf /)');
  // Inside single quotes, $ is literal
  assert.equal(result, "'$(rm -rf /)'");
});

test('shellEscape prevents backtick execution', () => {
  const result = shellEscape('`whoami`');
  assert.equal(result, "'`whoami`'");
});

test('shellEscape handles semicolons and pipes', () => {
  assert.equal(shellEscape('foo; bar | baz'), "'foo; bar | baz'");
});

test('shellEscape handles newlines', () => {
  assert.equal(shellEscape('line1\nline2'), "'line1\nline2'");
});

test('shellEscape handles double quotes', () => {
  assert.equal(shellEscape('say "hello"'), "'say \"hello\"'");
});

test('shellEscape handles multiple single quotes', () => {
  const result = shellEscape("it's Bob's");
  const quoteCount = (result.match(/\\'/g) || []).length;
  assert.equal(quoteCount, 2, 'should escape both single quotes');
});

test('shellEscape handles redirects', () => {
  assert.equal(shellEscape('> /etc/passwd'), "'> /etc/passwd'");
});

test('shellEscape handles backslashes', () => {
  assert.equal(shellEscape('path\\to\\file'), "'path\\to\\file'");
});
