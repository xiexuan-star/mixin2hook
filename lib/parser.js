import fs from 'fs';
import { Transformer } from './transformer.js';
import { Collector } from './collector.js';
import * as vueCompiler from 'vue/compiler-sfc';


function readFile(filePath) {
  return fs.readFileSync(filePath, { encoding: 'utf8' });
}

function parser(filePath) {
  const source = readFile(filePath);

  if (filePath.endsWith('.vue')) {
    try {
      parseSFC(source);
    } catch (e) {
      console.log(e);
    }
  } else {
    parseHook(source);
  }
}

function parseHook(source) {
  const collector = new Collector(source);
  collector.collect();

  const transformer = new Transformer(collector);
  transformer.transform();

  fs.writeFile('./example/output.ts', transformer.code, err => {
    //
  });
}

function parseSFC(source) {
  const sfc = vueCompiler.parse(source);
  const { template, script: { content } } = sfc.descriptor;

  const collector = new Collector(content);
  collector.collect();

  const transformer = new Transformer(collector);
  transformer.transform();

  fs.writeFile('./example/output.vue', `<template>${template.content}</template>\n<script lang="ts" setup>
${transformer.code}
</script>`, err => {
    //
  });
}

parser('./example/index.js');
