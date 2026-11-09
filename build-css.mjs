// Резервный мини-компилятор SCSS → CSS (без зависимостей).
// Поддерживает: $переменные, вложенность с &, @mixin/@include (без аргументов),
// @media (в т.ч. внутри правил), @keyframes, комментарии //.
// Основной путь сборки: `npm run build` (пакет sass). Этот файл нужен, если sass недоступен.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [, , input = 'scss/main.scss', output = 'css/main.css'] = process.argv;
let src = readFileSync(input, 'utf8');

// 1. Комментарии и переменные
src = src.replace(/\/\/.*$/gm, '');
const vars = {};
src = src.replace(/\$([\w-]+)\s*:\s*([^;]+);/g, (_, name, value) => {
  vars[name] = value.trim();
  return '';
});
for (const name of Object.keys(vars).sort((a, b) => b.length - a.length)) {
  src = src.split('$' + name).join(vars[name]);
}

// 2. Парсер блоков
function parse(text) {
  let i = 0;
  function block() {
    const items = [];
    let buf = '';
    while (i < text.length) {
      const ch = text[i];
      if (ch === '{') {
        const head = buf.trim();
        buf = '';
        i++;
        if (head.startsWith('@keyframes')) {
          let depth = 1;
          const start = i;
          while (depth && i < text.length) {
            if (text[i] === '{') depth++;
            if (text[i] === '}') depth--;
            i++;
          }
          items.push({ raw: head + '{' + text.slice(start, i - 1).replace(/\s+/g, ' ').trim() + '}' });
        } else {
          items.push({ sel: head, items: block() });
        }
      } else if (ch === '}') {
        i++;
        if (buf.trim()) items.push({ decl: buf.trim() });
        return items;
      } else if (ch === ';') {
        i++;
        if (buf.trim()) items.push({ decl: buf.trim() });
        buf = '';
      } else {
        buf += ch;
        i++;
      }
    }
    if (buf.trim()) items.push({ decl: buf.trim() });
    return items;
  }
  return block();
}

const tree = parse(src);

// 3. Миксины
const mixins = {};
function collectMixins(items) {
  return items.filter((n) => {
    if (n.sel && n.sel.startsWith('@mixin')) {
      mixins[n.sel.replace('@mixin', '').trim()] = n.items;
      return false;
    }
    return true;
  });
}
function expand(items) {
  const out = [];
  for (const n of items) {
    if (n.decl && n.decl.startsWith('@include')) {
      const name = n.decl.replace('@include', '').trim();
      if (!mixins[name]) throw new Error('Неизвестный миксин: ' + name);
      out.push(...expand(mixins[name]));
    } else if (n.items) {
      out.push({ sel: n.sel, items: expand(n.items) });
    } else out.push(n);
  }
  return out;
}
const flat = expand(collectMixins(tree));

// 4. Генерация CSS
const css = [];
function combine(parents, sel) {
  const parts = sel.split(',').map((s) => s.trim());
  const res = [];
  for (const p of parents) {
    for (const part of parts) {
      res.push(part.includes('&') ? part.replace(/&/g, p) : p ? p + ' ' + part : part);
    }
  }
  return res;
}
function emit(items, parents, wrap) {
  const decls = items.filter((n) => n.decl).map((n) => n.decl.replace(/\s+/g, ' '));
  if (decls.length && parents.length) {
    const rule = parents.join(',\n') + ' {\n  ' + decls.join(';\n  ') + ';\n}';
    css.push(wrap ? wrap + ' {\n' + rule.replace(/^/gm, '  ') + '\n}' : rule);
  }
  for (const n of items) {
    if (n.raw) css.push(n.raw);
    else if (n.sel && n.sel.startsWith('@media')) emit(n.items, parents, n.sel);
    else if (n.sel) emit(n.items, combine(parents.length ? parents : [''], n.sel), wrap);
  }
}
emit(flat, [], '');

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, '/* Сгенерировано из scss/main.scss. Не редактировать вручную. */\n' + css.join('\n\n') + '\n');
console.log(`OK: ${output} (${css.length} блоков)`);
