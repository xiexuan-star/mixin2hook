import fs from 'fs';
import { Transformer } from './transformer.js';
import { Collector } from './collector.js';
import * as vueCompiler from 'vue/compiler-sfc';


function readFile(filePath) {
  return fs.readFileSync(filePath, { encoding: 'utf8' });
}

function parseHook(source, output) {
  const collector = new Collector(source);
  collector.collect();

  const transformer = new Transformer(collector);
  transformer.transform();
  fs.writeFile(output.replace(/js$/, 'ts'), transformer.assembleHook(output.match(/\/([^\/]+)\.[tj]s$/)[1]), err => {
    //
  });
}

function parseSFC(source, output) {
  const sfc = vueCompiler.parse(source);
  const { template, script: { content } } = sfc.descriptor;

  const collector = new Collector(content);
  collector.collect();

  const transformer = new Transformer(collector);
  transformer.transform();

  fs.writeFile(output, transformer.assembleSFC(`<template>${template.content}</template>`), err => {
    //
  });
}

export function parse(input, output) {
  output = output || input.replace(/\/([^\/]+).(ts|js|vue)$/, '/$1_vue3.$2');
  const source = readFile(input);

  if (input.endsWith('.vue')) {
    parseSFC(source, output);
  } else {
    parseHook(source, output);
  }
}

parse('./example/index.vue');
