const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compile, terms } = require('../media/file-filter');
const files = ['src/train.py', 'src/kernels/a.cu', 'tests/test_train.py', 'docs/guide.md', 'README.md', 'src/a.cpp'];
const filter = (include, exclude, regex) => files.filter(path => compile(include, exclude, regex)({ path }));

test('file filtering combines OR inclusions and overriding exclusions', () => {
  assert.deepEqual(filter('train, README', 'tests/'), ['src/train.py', 'README.md']);
  assert.deepEqual(filter('', '*.md'), ['src/train.py', 'src/kernels/a.cu', 'tests/test_train.py', 'src/a.cpp']);
  assert.deepEqual(filter('*.{cu,cpp}, **/test_*.py', 'src/a.cpp'), ['src/kernels/a.cu', 'tests/test_train.py']);
  assert.deepEqual(filter('src/*.py', ''), ['src/train.py']);
  assert.deepEqual(filter('src/**', ''), ['src/train.py', 'src/kernels/a.cu', 'src/a.cpp']);
  assert.equal(compile('**/README.?d')({ path: 'README.md' }), true);
  assert.equal(compile('src/*.py')({ path: 'src/deep/train.py' }), false);
  assert.equal(compile('TRAIN')({ path: 'src/train.py' }), true);
  assert.equal(compile('legacy/', 'generated/')({ path: 'src/new.py', oldPath: 'legacy/old.py' }), true);
  assert.equal(compile('', 'legacy/')({ path: 'src/new.py', oldPath: 'legacy/old.py' }), false);
});

test('regex, braces and literal commas retain their intended grouping', () => {
  assert.deepEqual(filter('(^|/)(train|test_train)\\.py$', 'tests/', true), ['src/train.py']);
  assert.deepEqual(filter('^src/,README', '\\.(cu|cpp)$', true), ['src/train.py', 'README.md']);
  assert.deepEqual(terms('*.{py,cu},foo{1,3},[a,b],(x,y),"file,name.py"'), ['*.{py,cu}', 'foo{1,3}', '[a,b]', '(x,y)', 'file,name.py']);
  assert.equal(compile('name\\,part', '', true)({ path: 'name,part' }), true);
  assert.equal(compile('"name,part"')({ path: 'name,part' }), true);
  assert.equal(compile('a{1,3}', '', true)({ path: 'aaa' }), true);
  assert.throws(() => compile('[', '', true), error => error.field === 'include');
  assert.throws(() => compile('', '(', true), error => error.field === 'exclude');
  assert.throws(() => compile('*.{py,cu'), error => error.field === 'include');
});
