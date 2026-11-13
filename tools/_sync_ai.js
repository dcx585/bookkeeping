#!/usr/bin/env node
/* sync_ai.sh 的实际逻辑（shell 里写 JS 转义太容易出错，拆成独立文件） */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHECK = process.env.AI_SYNC_MODE === 'check';

const src = fs.readFileSync(path.join(ROOT, 'js/ai-parse.js'), 'utf8');
let html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

const BEGIN = '/* ===== AI-PARSE-BEGIN ===== */';
const END = '/* ===== AI-PARSE-END ===== */';

const i = html.indexOf(BEGIN);
const j = html.indexOf(END);

if (i < 0 || j < 0) {
  console.error('❌ app.html 里找不到 AI-PARSE 标记，请先手动注入一次');
  process.exit(1);
}

const current = html.slice(i + BEGIN.length, j).trim();
const want = src.trim();

if (current === want) {
  console.log('✓ ai-parse.js 已同步');
  process.exit(0);
}

if (CHECK) {
  console.error('❌ app.html 里的 AI 模块与 js/ai-parse.js 不一致');
  console.error('   跑 sh tools/sync_ai.sh 同步');
  process.exit(1);
}

html = html.slice(0, i + BEGIN.length) + '\n' + src + '\n' + html.slice(j);
fs.writeFileSync(path.join(ROOT, 'app.html'), html);
console.log('✓ 已同步（' + src.length + ' 字节）');
