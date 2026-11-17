(function(root) {
  function terms(query) {
    const result = []; let start = 0, escaped = false, quote = '', round = 0, square = 0, brace = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query[i];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '[') square++; else if (char === ']') square = Math.max(0, square - 1);
      if (!square) {
        if (char === '(') round++; else if (char === ')') round = Math.max(0, round - 1);
        if (char === '{') brace++; else if (char === '}') brace = Math.max(0, brace - 1);
      }
      if (char === ',' && !round && !square && !brace) { result.push(query.slice(start, i).trim()); start = i + 1; }
    }
    result.push(query.slice(start).trim());
    return result.filter(Boolean).map(term => /^(["']).*\1$/.test(term) ? term.slice(1, -1) : term);
  }

  function glob(pattern) {
    let source = '';
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === '\\' && i + 1 < pattern.length) { source += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
      else if (char === '*' && pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') { source += '(?:.*/)?'; i++; } else source += '.*';
      } else if (char === '*') source += '[^/]*';
      else if (char === '?') source += '[^/]';
      else if (char === '{') {
        const end = pattern.indexOf('}', i + 1);
        if (end < 0) throw new Error('Unclosed glob group');
        source += '(?:' + pattern.slice(i + 1, end).split(',').map(value => glob(value)).join('|') + ')'; i = end;
      } else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return source;
  }

  function compile(include = '', exclude = '', regex = false) {
    const compileSide = (text, field) => {
      try {
        return terms(text).map(pattern => {
          if (regex) { const expression = new RegExp(pattern, 'i'); return value => expression.test(value); }
          if (!/[?*{]/.test(pattern)) { const needle = pattern.replace(/\\,/g, ',').toLowerCase(); return value => value.toLowerCase().includes(needle); }
          const expression = new RegExp((pattern.startsWith('/') ? '^' : '(?:^|/)') + glob(pattern.replace(/^\//, '')) + '$', 'i');
          return value => expression.test(value);
        });
      } catch (error) { error.field = field; throw error; }
    };
    const includes = compileSide(include, 'include'), excludes = compileSide(exclude, 'exclude');
    return file => {
      const paths = [file.path, file.oldPath].filter(Boolean);
      return (!includes.length || paths.some(value => includes.some(match => match(value))))
        && !paths.some(value => excludes.some(match => match(value)));
    };
  }
  const api = { compile, terms };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KianFileFilter = api;
})(typeof window === 'undefined' ? undefined : window);
